<#Requires -Version 5.1
<#
.SYNOPSIS
  Builds the frozen QIROVA backend bundle (PyInstaller onedir, windowed).
.DESCRIPTION
  Proven flags (2026-10-03): the bundle MUST include qiskit data files
  (qiskit/VERSION.txt is read at import time - without --collect-all qiskit,
  every circuit build fails) plus pylatexenc + matplotlib (circuit SVG render).
  backend_server.py passes use_colors=False so a stdio-less double-click
  launch does not crash uvicorn's logging setup (sys.stdout is None).
  Post-build asserts fail fast instead of shipping a broken bundle.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File packaging\build-backend-bundle.ps1
#>
param(
    [string]$BeSrc      = "D:\Qirova-IDE\ECDAT-IDE-verify\backend",
    [string]$VenvPython = "D:\Qirova-IDE\ecdat-ide-build\backend\.venv\Scripts\python.exe",
    [string]$OutDir     = "E:\backend-dist2"
)
$ErrorActionPreference = "Stop"
function ERR($m) { Write-Host "  [ERR] $m" -ForegroundColor Red; throw $m }

foreach ($f in @("$BeSrc\backend_server.py", $VenvPython)) {
    if (-not (Test-Path -LiteralPath $f)) { ERR "missing: $f" }
}
$pyinstaller = Join-Path (Split-Path $VenvPython) "pyinstaller.exe"
if (-not (Test-Path -LiteralPath $pyinstaller)) { ERR "missing: $pyinstaller" }
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "opencode\pybuild-be"
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
if (Test-Path -LiteralPath $OutDir) { Remove-Item -LiteralPath $OutDir -Recurse -Force }

$env:QIROVA_ALLOW_SUBPROCESS = "1"  # build host may have a backend running (single-server guard)
& $pyinstaller --onedir --noconsole --name QIROVA-backend `
    --distpath $OutDir --workpath $tmp --specpath $tmp `
    --paths $BeSrc `
    --collect-all src --collect-all gateway `
    --collect-submodules all_models --collect-submodules models --collect-submodules quantum_redteam `
    --collect-all pylatexenc --collect-all matplotlib `
    --collect-all qiskit --collect-all qiskit_aer `
    --copy-metadata scikit-learn --copy-metadata pydantic --copy-metadata matplotlib `
    --exclude-module pytest --exclude-module pip --exclude-module setuptools --exclude-module tkinter `
    (Join-Path $BeSrc "backend_server.py")
if ($LASTEXITCODE -ne 0) { ERR "pyinstaller failed ($LASTEXITCODE)" }

foreach ($f in @("QIROVA-backend\QIROVA-backend.exe",
                "QIROVA-backend\_internal\qiskit\VERSION.txt",
                "QIROVA-backend\_internal\pylatexenc",
                "QIROVA-backend\_internal\matplotlib")) {
    if (-not (Test-Path -LiteralPath (Join-Path $OutDir $f))) { ERR "bundle missing: $f" }
}
Write-Host "  [OK] bundle built at $OutDir (exe + qiskit data + render deps present)" -ForegroundColor Green
