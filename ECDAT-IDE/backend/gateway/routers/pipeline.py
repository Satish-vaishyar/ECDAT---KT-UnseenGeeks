"""
Gateway Pipeline & Scan Store Router
Exposes:
1. POST /api/v1/pipeline/audit       -> Runs 5-stage sequential audit within 4GB VRAM budget
2. GET  /api/v1/scans                -> Frontend scan history (paginated, sorted, filtered)
3. GET  /api/v1/scans/{scan_id}      -> Frontend detailed findings & snippets drilldown
4. GET  /api/v1/scans/{scan_id}/cbom -> CycloneDX 1.6 CBOM JSON download (ECMA-424; algorithms, certificates, keys + relationships)
5. GET  /api/v1/scans/{scan_id}/export/csv -> CSV file download
6. GET  /api/v1/system/resources     -> Real-time VRAM/RAM telemetry for UI resource meters
7. POST /api/v1/system/evict         -> Manual VRAM cache flush & model purge
"""
import os
import sys
import json
import asyncio
import base64
import binascii
import tempfile
import shutil
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from src.ecdat.core.resource_manager import get_resource_manager, MemoryTelemetry
from src.ecdat.core.scan_store import get_scan_store
from src.ecdat.core.pipeline_orchestrator import get_pipeline_orchestrator

router = APIRouter(prefix="/api/v1", tags=["pipeline"])


BACKEND_ROOT = Path(__file__).resolve().parents[2]
AUDIT_CHILD = str(BACKEND_ROOT / "run_audit_child.py")
_audit_sem = asyncio.Semaphore(1)


async def _audit_in_worker(_orchestrator, **kwargs) -> Dict[str, Any]:
    """Run the blocking multi-model audit in an isolated child process.

    audit_code() is coroutine-shaped but CPU-bound for minutes and native ML
    extensions have crashed the gateway process mid-audit. A child process
    keeps the gateway alive no matter what: crashes/timeouts surface as 503
    while health and every other route keep serving. One audit at a time
    (memory safety); concurrent callers get 429.
    """
    if _audit_sem.locked():
        raise HTTPException(status_code=429, detail="audit already running, try again shortly")
    async with _audit_sem:
        timeout_s = float(os.environ.get("ECDAT_AUDIT_DEADLINE_S", "480")) + 180
        with tempfile.TemporaryDirectory(prefix="ecdat_audit_") as tmp:
            req_path = os.path.join(tmp, "req.json")
            out_path = os.path.join(tmp, "out.json")
            with open(req_path, "w", encoding="utf-8") as f:
                json.dump({"kwargs": kwargs}, f, default=str)
            proc = await asyncio.create_subprocess_exec(
                sys.executable, AUDIT_CHILD, req_path, out_path,
                cwd=str(BACKEND_ROOT), env=os.environ.copy(),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            try:
                await asyncio.wait_for(proc.wait(), timeout=timeout_s)
            except asyncio.TimeoutError:
                try:
                    proc.kill()
                except Exception:
                    pass
                raise HTTPException(status_code=503, detail="audit timed out")
            if proc.returncode != 0 or not os.path.exists(out_path):
                raise HTTPException(status_code=503, detail="audit worker failed")
            with open(out_path, encoding="utf-8") as f:
                return json.load(f)


class AuditRequest(BaseModel):
    code: Optional[str] = None
    file_path: Optional[str] = None
    target_name: Optional[str] = "input_code.py"
    language: str = "python"
    enable_remediation: bool = True
    metadata: Optional[Dict[str, Any]] = None


class UploadedFile(BaseModel):
    path: str
    content_base64: str


class UploadAuditRequest(BaseModel):
    files: List[UploadedFile] = Field(..., min_length=1, max_length=200)
    target_name: str = "uploaded_asset"
    language: str = "python"
    enable_remediation: bool = True


@router.post("/pipeline/audit", response_model=Dict[str, Any])
async def run_sequential_audit(req: AuditRequest):
    """
    Executes end-to-end multi-model cryptographic discovery, CWE misuse detection,
    and PQC remediation under strict single-occupancy GPU lock (safe for 4GB VRAM).
    Auto-saves complete scan artifacts to ScanStore for frontend retrieval.
    """
    code = req.code or ""
    if not code and req.file_path:
        try:
            with open(req.file_path, "r", encoding="utf-8", errors="replace") as f:
                code = f.read()
        except OSError as e:
            raise HTTPException(status_code=400, detail=f"Cannot read file_path: {e}")

    if not code:
        raise HTTPException(status_code=422, detail="Provide 'code' or readable 'file_path'")

    orchestrator = get_pipeline_orchestrator()
    target_name = req.target_name or (Path(req.file_path).name if req.file_path else "snippet.py")

    result = await _audit_in_worker(
        orchestrator,
        code=code,
        target_name=target_name,
        language=req.language,
        enable_remediation=req.enable_remediation,
        metadata=req.metadata
    )
    return result


@router.post("/pipeline/upload-audit", response_model=Dict[str, Any])
async def run_uploaded_audit(req: UploadAuditRequest):
    """Analyze uploaded files from a temporary directory and always clean up."""
    temp_dir = Path(tempfile.mkdtemp(prefix="ecdat_upload_"))
    total_bytes = 0
    try:
        source_parts: list[str] = []
        supported = {".py", ".java", ".js", ".ts", ".go", ".rs", ".c", ".cpp", ".h", ".cs"}
        for uploaded in req.files:
            relative = Path(uploaded.path.replace("\\", "/"))
            if relative.is_absolute() or ".." in relative.parts:
                raise HTTPException(status_code=400, detail="Invalid upload path")
            try:
                raw = base64.b64decode(uploaded.content_base64, validate=True)
            except (ValueError, binascii.Error) as exc:
                raise HTTPException(status_code=422, detail=f"Invalid base64 upload: {uploaded.path}") from exc
            total_bytes += len(raw)
            if total_bytes > 25 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Uploaded data exceeds the 25 MB limit")
            destination = temp_dir / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)
            if destination.suffix.lower() in supported:
                source_parts.append(f"# FILE: {relative.as_posix()}\n" + raw.decode("utf-8", errors="replace"))
        if not source_parts:
            raise HTTPException(status_code=422, detail="Upload must contain a supported source file")
        code = "\n\n".join(source_parts)
        result = await _audit_in_worker(
            get_pipeline_orchestrator(),
            code=code,
            target_name=req.target_name or req.files[0].path,
            language=req.language,
            enable_remediation=req.enable_remediation,
            metadata={"uploaded_files": len(req.files), "uploaded_bytes": total_bytes,
                      "temporary_storage": True},
        )
        return result
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.get("/scans", response_model=List[Dict[str, Any]])
async def list_scans(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    risk_filter: Optional[str] = Query(default=None, description="Filter by CRITICAL, HIGH, MEDIUM, LOW, NONE")
):
    """
    Returns scan history for frontend dashboards and tables.
    """
    store = get_scan_store()
    return store.list_scans(limit=limit, offset=offset, risk_filter=risk_filter)


@router.get("/scans/{scan_id}", response_model=Dict[str, Any])
async def get_scan_details(scan_id: str):
    """
    Returns full scan summary, findings list, line numbers, and CWE tags for drilldown view.
    """
    store = get_scan_store()
    scan = store.get_scan(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail=f"Scan ID '{scan_id}' not found")
    return scan


@router.get("/scans/{scan_id}/cbom", response_model=Dict[str, Any])
async def get_scan_cbom(scan_id: str):
    """
    Returns a CycloneDX-compatible CBOM (CycloneDX 1.6 / ECMA-424) JSON.

    Covers algorithms, certificates, keys and their relationships
    (bom-ref + dependencies). IBM's CBOM work was upstreamed into CycloneDX 1.6.
    """
    store = get_scan_store()
    cbom = store.get_cbom(scan_id)
    if not cbom:
        raise HTTPException(status_code=404, detail=f"CBOM for scan ID '{scan_id}' not found")
    return cbom


@router.get("/scans/{scan_id}/export/csv")
async def export_scan_csv(scan_id: str):
    """
    Exports findings as a downloadable spreadsheet CSV.
    """
    store = get_scan_store()
    csv_path = store.get_csv_path(scan_id)
    if not csv_path or not csv_path.exists():
        raise HTTPException(status_code=404, detail=f"CSV for scan ID '{scan_id}' not found")
    return FileResponse(
        path=str(csv_path),
        filename=f"{scan_id}_findings.csv",
        media_type="text/csv"
    )


@router.get("/scans/{scan_id}/report")
async def get_scan_audit_report(scan_id: str, download: bool = Query(default=False)):
    """
    Returns the comprehensive 29-model Post-Quantum Cryptographic Markdown Audit Report.
    If ?download=true, prompts file download as ECDAT_AUDIT_{scan_id}.md.
    """
    store = get_scan_store()
    report_text = store.get_audit_report(scan_id)
    if not report_text:
        raise HTTPException(status_code=404, detail=f"Audit report for scan ID '{scan_id}' not found")

    if download:
        report_file = store.base_dir / scan_id / "AUDIT_REPORT.md"
        return FileResponse(
            path=str(report_file),
            filename=f"ECDAT_AUDIT_{scan_id}.md",
            media_type="text/markdown"
        )

    return Response(content=report_text, media_type="text/markdown; charset=utf-8")



@router.get("/system/resources", response_model=MemoryTelemetry)
async def get_system_resources():
    """
    Polls real-time VRAM and System RAM telemetry for frontend resource meters.
    """
    rm = get_resource_manager()
    return rm.get_telemetry()


@router.post("/system/evict")
async def force_vram_eviction():
    """
    Administrative endpoint to purge active models from VRAM and run garbage collection.
    """
    rm = get_resource_manager()
    success = rm.evict_active_model(force=True)
    telemetry = rm.get_telemetry()
    return {
        "status": "success" if success else "failed",
        "message": "VRAM cache and active model purged",
        "telemetry": telemetry
    }
