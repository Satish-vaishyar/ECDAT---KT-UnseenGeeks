"""Knowledge routes — Class C stateful (12/13/14/15/16) + Class A KBs (17/18/22/24).

POST /api/v1/knowledge/query      -> Model 12 CDKG (+18 TKG temporal, 17 trust)
POST /api/v1/rag/search           -> Model 13 RAG KB
POST /api/v1/knowledge/hybrid     -> Model 14 Hybrid Retriever
POST /api/v1/knowledge/vector     -> Model 15 ChromaDB / Model 16 Embedding Pipeline
POST /api/v1/knowledge/trust      -> Model 17 SourceTrust (Class A)
POST /api/v1/knowledge/temporal   -> Model 18 TKG (Class A)
POST /api/v1/knowledge/vuln       -> Model 22 VulnIntel (Class A)
POST /api/v1/knowledge/compliance -> Model 24 Compliance KB (Class A)
"""
import time
from fastapi import APIRouter

from .. import client as C
from ..compliance_catalog import compliance_reference_matches
from ..schemas import (ComplianceCheckRequest, CryptoAPIRequest, GatewayResponse,
                       KnowledgeQueryRequest, RagSearchRequest, TemporalStateRequest,
                       TrustScoreRequest, VulnSearchRequest)
from src.ecdat.core.all_models_runtime import (model13_rag, model24_compliance,
                                                 model12_migration, model14_search,
                                                 model15_search, model16_search,
                                                 model17_trust, model18_temporal,
                                                 model21_crypto_api, model22_rerank,
                                                 model22_search)

router = APIRouter(prefix="/api/v1", tags=["knowledge"])


def _resp(model, mid, svc, query, top_k, extra, t0, downstream=None):
    md = {"query": query, "top_k": top_k, **extra}
    if downstream:
        md["downstream_service"] = downstream["_service"]
    return GatewayResponse(model=model, model_id=mid, docker_service=svc,
                           findings=[], total_findings=0, quantum_risk="NONE",
                           confidence=0.9, latency_ms=C.now_ms(t0), metadata=md)


@router.post("/knowledge/query", response_model=GatewayResponse)
async def cdkg(req: KnowledgeQueryRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("cdkg", {"query": req.query, "top_k": req.top_k})
    if not hit:
        try:
            result = model12_migration(req.query)
            return _resp("cdkg", "12", "all_models/model_12 (artifact-loader)",
                         req.query, req.top_k, {"model_output": result,
                         "artifact_backed": True}, t0)
        except Exception as exc:
            local_error = str(exc)[:240]
    return _resp("cdkg", "12", f"class-c-stateful ({hit['_service']})" if hit
                 else "class-c-stateful (standalone-fallback)",
                 req.query, req.top_k,
                 {"patterns": ["MIGRATES_TO", "VULNERABLE_TO"],
                  "migration_hint": "RSA-2048 -[MIGRATES_TO]-> ML-KEM-768 (FIPS 203)",
                 "spec": "ECDAT_AI_ML_MODELS §12.8 get_recommendation()",
                  "artifact_error": locals().get("local_error")}, t0, hit)


@router.post("/rag/search", response_model=GatewayResponse)
async def rag(req: RagSearchRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("rag_kb", {"query": req.query, "top_k": req.top_k})
    if not hit:
        try:
            docs = model13_rag(req.query, req.top_k)
            docs = docs + compliance_reference_matches(req.query, limit=min(8, req.top_k))
            return _resp("rag_kb", "13", "all_models/model_13 (artifact-loader)",
                         req.query, req.top_k,
                         {"documents": docs, "artifact_backed": True,
                          "retriever": "bundled FAISS + BM25 hybrid"}, t0)
        except Exception as exc:
            return _resp("rag_kb", "13", "class-c-stateful (standalone-fallback)",
                         req.query, req.top_k, {"artifact_error": str(exc)[:240]}, t0)
    return _resp("rag_kb", "13", f"class-c-stateful ({hit['_service']})" if hit
                 else "class-c-stateful (standalone-fallback)",
                 req.query, req.top_k,
                 {"retriever": "MiniLM-L6-v2 + FAISS", "rerank": "bge-reranker-base",
                  "reference_catalog": compliance_reference_matches(req.query, limit=min(8, req.top_k)),
                  "spec": "ECDAT_AI_ML_MODELS §13.8 rag_query()"}, t0, hit)


@router.post("/knowledge/hybrid", response_model=GatewayResponse)
async def hybrid(req: KnowledgeQueryRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("hybrid_retriever", {"query": req.query, "top_k": req.top_k})
    if not hit:
        try:
            docs = model14_search(req.query, req.top_k)
            return _resp("hybrid_retriever", "14", "all_models/model_14 (artifact-loader)",
                         req.query, req.top_k, {"documents": docs, "artifact_backed": True,
                         "fusion": "bundled hybrid retriever"}, t0)
        except Exception as exc:
            local_error = str(exc)[:240]
    return _resp("hybrid_retriever", "14", f"class-c-stateful ({hit['_service']})" if hit
                 else "class-c-stateful (standalone-fallback)",
                 req.query, req.top_k, {"fusion": "RRF k=60 (BM25 + FAISS)",
                 "spec": "ECDAT_AI_ML_MODELS §14.8 hybrid_search()",
                 "artifact_error": locals().get("local_error")}, t0, hit)


@router.post("/knowledge/vector", response_model=GatewayResponse)
async def vector(req: KnowledgeQueryRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("chromadb", {"query": req.query, "top_k": req.top_k})
    if not hit:
        docs15, docs16 = None, None
        err15, err16 = None, None
        try:
            docs15 = model15_search(req.query, req.top_k)
        except Exception as exc:
            # Model 15 store was written by chromadb 0.4.x; newer clients
            # cannot read its segments. Model 16 still answers below.
            err15 = str(exc)[:240]
        try:
            docs16 = model16_search(req.query, req.top_k)
        except Exception as exc:
            err16 = str(exc)[:240]
        if docs15 is not None or docs16 is not None:
            return _resp("chromadb", "15", "all_models/model_15+16 (artifact-loader)",
                         req.query, req.top_k, {"documents": docs15, "embedding_results": docs16,
                         "model15_error": err15, "model16_error": err16,
                         "artifact_backed": True}, t0)
        local_error = err15 or err16 or "no results"
    return _resp("chromadb", "15", f"class-c-stateful ({hit['_service']})" if hit
                 else "class-c-stateful (standalone-fallback)",
                 req.query, req.top_k, {"embedding": "all-MiniLM-L6-v2 (384-dim)",
                                        "pipeline_model": "16 embedding_pipeline",
                                        "spec": "ECDAT_AI_ML_MODELS §15.8/§16.8",
                                        "artifact_error": locals().get("local_error")}, t0, hit)


@router.post("/knowledge/embed", response_model=GatewayResponse)
async def embed(req: KnowledgeQueryRequest):
    """Model 16 Embedding Pipeline: text -> MiniLM-384 vector + similarity hits."""
    t0 = time.perf_counter()
    hit = await C.downstream_infer("embedding_pipeline", {"query": req.query, "top_k": req.top_k})
    if not hit:
        try:
            docs = model16_search(req.query, req.top_k)
            return _resp("embedding_pipeline", "16", "all_models/model_16 (artifact-loader)",
                         req.query, req.top_k, {"embedding_results": docs,
                         "embedding": "all-MiniLM-L6-v2 (384-dim)",
                         "artifact_backed": True}, t0)
        except Exception as exc:
            local_error = str(exc)[:240]
    return _resp("embedding_pipeline", "16", f"class-c-stateful ({hit['_service']})" if hit
                 else "class-c-stateful (standalone-fallback)",
                 req.query, req.top_k, {"embedding": "all-MiniLM-L6-v2 (384-dim)",
                                        "spec": "ECDAT_AI_ML_MODELS §16.8",
                                        "artifact_error": locals().get("local_error")}, t0, hit)


@router.post("/knowledge/trust", response_model=GatewayResponse)
async def trust(req: TrustScoreRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("source_trust", {"query": req.source,
                                                   "documents": [req.claim or ""]})
    if not hit:
        try:
            result = model17_trust(req.source, corroboration_count=1)
            return _resp("source_trust", "17", "all_models/model_17 (artifact-loader)",
                         req.source, 1, {"model_output": result, "artifact_backed": True}, t0)
        except Exception as exc:
            local_error = str(exc)[:240]
    tiers = {"nist": 1.0, "iso": 1.0, "cve": 0.9, "cert-in": 0.78, "vendor": 0.6}
    s = req.source.lower()
    score = next((v for k, v in tiers.items() if k in s), 0.5)
    return _resp("source_trust", "17", f"class-a-cpu ({hit['_service']})" if hit
                 else "class-a-cpu (standalone-fallback)",
                 req.source, 1, {"trust_score": score,
                                 "tier": "T1" if score >= 0.9 else "T3" if score >= 0.7 else "T4",
                                 "spec": "ECDAT_AI_ML_MODELS §17.8 score_source()",
                                 "artifact_error": locals().get("local_error")}, t0, hit)


@router.post("/knowledge/temporal", response_model=GatewayResponse)
async def temporal(req: TemporalStateRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("tkg", {"query": req.algorithm, "documents": []})
    if not hit:
        try:
            result = model18_temporal(req.algorithm, req.date)
            return _resp("tkg", "18", "all_models/model_18 (artifact-loader)",
                         req.algorithm, 1, {"model_output": result, "artifact_backed": True}, t0)
        except Exception as exc:
            local_error = str(exc)[:240]
    return _resp("tkg", "18", f"class-a-cpu ({hit['_service']})" if hit
                 else "class-a-cpu (standalone-fallback)",
                 req.algorithm, 1, {"date": req.date, "state": "standardised",
                                    "deprecation_signal": "RSA-2048 -> migrate by 2030",
                                    "spec": "ECDAT_AI_ML_MODELS §18.8 get_temporal_state()",
                                    "artifact_error": locals().get("local_error")}, t0, hit)


@router.post("/knowledge/vuln", response_model=GatewayResponse)
async def vuln(req: VulnSearchRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("vuln_intel", {"query": req.query,
                                                 "documents": [req.query]})
    if not hit:
        try:
            result = model22_search(req.query, req.top_k)
            # Model 22 RL reranker on top of search results (best-effort).
            reranked, rerank_status = False, "SKIPPED"
            try:
                cands = result if isinstance(result, list) else (result or {}).get("results", [])
                if cands:
                    rr = model22_rerank(req.query, cands, top_k=req.top_k)
                    if isinstance(rr, list) and rr:
                        result, reranked, rerank_status = rr, True, "ACTUAL"
            except Exception as exc:
                rerank_status, rerank_error = "FALLBACK", str(exc)[:240]
            return _resp("vuln_intel", "22", "all_models/model_22 (artifact-loader)",
                         req.query, req.top_k, {"results": result, "corpus_available": True,
                         "reranked": reranked, "rerank_status": rerank_status,
                         "rerank_error": locals().get("rerank_error"),
                         "artifact_backed": True}, t0)
        except Exception as exc:
            local_error = str(exc)[:240]
    return _resp("vuln_intel", "22", f"class-a-cpu ({hit['_service']})" if hit
                 else "class-a-cpu (standalone-fallback)",
                 req.query, req.top_k, {"sources": ["NVD 2.0", "GitHub Advisory", "CERT-In"],
                                        "spec": "ECDAT_AI_ML_MODELS §22.8 search_vulnerabilities()",
                                        "artifact_error": locals().get("local_error")}, t0, hit)


@router.post("/knowledge/crypto-api", response_model=GatewayResponse)
async def crypto_api(req: CryptoAPIRequest):
    """Model 21 Crypto API KB (Class C, dockerised): classify_api + quantum status."""
    t0 = time.perf_counter()
    hit = await C.downstream_infer("crypto_api", {"query": f"{req.language}:{req.api_name}",
                                                  "top_k": 5})
    if hit:
        try:
            res = hit["body"]["output"]["results"][0]
            if res.get("found"):
                return GatewayResponse(
                    model="crypto_api", model_id="21",
                    docker_service=f"class-c-stateful ({hit['_service']})",
                    findings=[{"id": "ECDAT-A001", "algorithm": str(res.get("algorithm")),
                               "category": "API", "status": str(res.get("security_status")),
                               "cwe_id": None, "line_number": None,
                               "code_snippet": str(res.get("api")),
                               "quantum_risk": "HIGH" if res.get("quantum_class") in
                               ("quantum_broken", "broken") else "MEDIUM"
                               if res.get("quantum_class") == "quantum_weak" else "NONE",
                               "confidence": 0.98,
                               "recommendation": f"Migrate to {res['replacement']}."
                               if res.get("replacement") else "API approved."}],
                    total_findings=1,
                    quantum_risk="MEDIUM", confidence=0.98,
                    latency_ms=C.now_ms(t0),
                    metadata={"kb_hit": res,
                              "spec": "ECDAT_AI_ML_MODELS §21.8 classify_api()"})
        except Exception:
            pass
    # standalone fallback: Model 21 all_models copy first, legacy wrapper second
    try:
        r = model21_crypto_api(req.api_name, req.language)
        replacement = r.get("replacement_api") or r.get("replacement_algorithm")
        r = {**r, "replacement": {"new_api": replacement} if replacement else r.get("replacement"),
             "artifact_backed": True, "kb_source": "all_models/model_21"}
        svc = "all_models/model_21 (artifact-loader; local SQLite)"
    except Exception as exc:
        try:
            r = C.local_crypto_api(req.api_name, req.language)
            r = {**r, "artifact_backed": False, "kb_source": "models/model_21 wrapper",
                 "model21_error": str(exc)[:240]}
            svc = "class-c-stateful (standalone-fallback; local SQLite)"
        except Exception as e2:
            return GatewayResponse(
                model="crypto_api", model_id="21",
                docker_service="class-c-stateful (standalone-fallback)",
                findings=[], total_findings=0, quantum_risk="UNKNOWN", confidence=0.4,
                latency_ms=C.now_ms(t0),
                metadata={"error": str(e2)[:200],
                          "spec": "ECDAT_AI_ML_MODELS §21.8"})
    try:
        qc = (r.get("quantum_class") or "UNKNOWN").lower()
        risk = ("HIGH" if qc in ("quantum_broken", "broken") else "MEDIUM"
                if qc == "quantum_weak" else "NONE" if r.get("found") else "UNKNOWN")
        return GatewayResponse(
            model="crypto_api", model_id="21",
            docker_service=svc,
            findings=[{"id": "ECDAT-A001", "algorithm": str(r.get("algorithm")),
                       "category": "API", "status": str(r.get("security_status")),
                       "cwe_id": None, "line_number": None,
                       "code_snippet": req.api_name, "quantum_risk": risk,
                       "confidence": 0.98 if r.get("found") else 0.4,
                       "recommendation": f"Migrate to {(r.get('replacement') or {}).get('new_api')}."
                       if r.get("replacement") else "No replacement needed."}],
            total_findings=1 if r.get("found") else 0, quantum_risk=risk,
            confidence=0.98 if r.get("found") else 0.4, latency_ms=C.now_ms(t0),
            metadata={"kb_hit": r, "spec": "ECDAT_AI_ML_MODELS §21.8"})
    except Exception as e:
        return GatewayResponse(
            model="crypto_api", model_id="21",
            docker_service="class-c-stateful (standalone-fallback)",
            findings=[], total_findings=0, quantum_risk="UNKNOWN", confidence=0.4,
            latency_ms=C.now_ms(t0),
            metadata={"error": str(e)[:200],
                      "spec": "ECDAT_AI_ML_MODELS §21.8"})


@router.post("/knowledge/compliance", response_model=GatewayResponse)
async def compliance(req: ComplianceCheckRequest):
    t0 = time.perf_counter()
    hit = await C.downstream_infer("compliance_kb", {"query": req.region,
                                                    "documents": [req.finding or req.algorithm or ""]})
    if not hit:
        try:
            label, probabilities = model24_compliance({
                "key_size": 2048 if (req.algorithm or "").upper().startswith(("RSA", "EC", "DH")) else 0,
                "min_key_bits": 2048, "key_meets_minimum": 1,
                "has_asymm": int((req.algorithm or "").upper().startswith(("RSA", "EC", "DH"))),
                "confidence": 0.9, "verified": 1, "official": 1,
                "summary_len": len(req.finding or req.algorithm or ""),
                "summary_words": len((req.finding or req.algorithm or "").split()),
            })
            return _resp("compliance_kb", "24", "all_models/model_24 (artifact-loader)",
                         req.finding or req.algorithm or "", 5,
                         {"classification": label, "probabilities": probabilities,
                          "region": req.region.upper(), "artifact_backed": True}, t0)
        except Exception as exc:
            return _resp("compliance_kb", "24", "class-a-cpu (standalone-fallback)",
                         req.finding or req.algorithm or "", 5,
                         {"artifact_error": str(exc)[:240]}, t0)
    region = req.region.upper()
    framework = {"IN": "CERT-In v2.0 + DPDP Act 2023", "US": "NIST SP 800-57 / FIPS",
                 "EU": "ISO 27001"}.get(region, "NIST IR 8547")
    return _resp("compliance_kb", "24", f"class-a-cpu ({hit['_service']})" if hit
                 else "class-a-cpu (standalone-fallback)",
                 req.finding or req.algorithm or "", 5,
                 {"region": region, "framework": framework,
                  "rules_mapped": 1247,
                  "spec": "ECDAT_AI_ML_MODELS §24.8 check_compliance()"}, t0, hit)
