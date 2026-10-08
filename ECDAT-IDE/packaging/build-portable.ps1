<#Requires -Version 5.1
<#
.SYNOPSIS
  Assembles a demo-ready portable ZIP of QIROVA IDE (no install, no admin, runs from USB).
.DESCRIPTION
  Copies a built QIROVA tree (VSCodium base + backend + bundled extension) into a
  temp staging dir (excluding junk), drops PORTABLE-README.txt at the root, and
  Compress-Archives it to a portable ZIP that runs with zero setup (venv included).

  Layout context (see packaging/build-complete-installer.ps1 and BUILD-EXE.md):
    - SourceDir root holds VSCodium.exe (VSCodium base, cf. "VSCodium base found" check)
    - backend\gateway\main.py (FastAPI gateway, staged under backend/ incl. prebuilt venv)
    - resources\app\extensions\qirova-ide\package.json (deployed extension)
    - Launchers such as QIROVA-LAUNCH.cmd live at the tree root.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File packaging\build-portable.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File packaging\build-portable.ps1 `
    -SourceDir "D:\Qirova-IDE\ecdat-ide-build" -OutZip "D:\Qirova-IDE\QIROVA-Portable.zip"
.EXAMPLE
  # Exclude the prebuilt venv (smaller zip, requires first-run pip install):
  powershell -ExecutionPolicy Bypass -File packaging\build-portable.ps1 -IncludeVenv:$false
#>
param(
    [string]$SourceDir = "D:\Qirova-IDE\ecdat-ide-build",
    [string]$OutZip    = "D:\Qirova-IDE\QIROVA-Portable.zip",
    [switch]$IncludeVenv = $true
)

$ErrorActionPreference = 'Stop'

function Step($msg) {
    Write-Host ""
    Write-Host "=== $msg ===" -ForegroundColor Cyan
}

function OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function WARN($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function ERR($msg)  { Write-Host "  [ERR] $msg" -ForegroundColor Red; throw $msg }

# -- Guard: never copy from a drive root ---------------------------------------
# Requirement: validate SourceDir is not a drive root (regex ^[A-Za-z]:\\?$ -> abort).
$__srcTrimmed = ($SourceDir).Trim().TrimEnd('\', '/')
if ($__srcTrimmed -match '^[A-Za-z]:\\?$') {
    ERR "Refusing to copy from a drive root: '$SourceDir'. Pass a real build tree via -SourceDir."
}
# Also catch fully-rooted forms like 'D:\' that survive trimming differences.
try {
    $___full = [System.IO.Path]::GetFullPath($SourceDir)
    if ($___full -match '^[A-Za-z]:\\?$') {
        ERR "Refusing to copy from a drive root: '$SourceDir'. Pass a real build tree via -SourceDir."
    }
} catch { }

# -- Stage 1: validate source markers ------------------------------------------
Step "Stage 1/5: Validate source tree ($SourceDir)"
if (-not (Test-Path -LiteralPath $SourceDir -PathType Container)) {
    ERR "SourceDir not found or not a directory: $SourceDir"
}

$markers = @(
    "VSCodium.exe",
    "backend\gateway\main.py",
    "resources\app\extensions\qirova-ide\package.json"
)
foreach ($m in $markers) {
    $p = Join-Path $SourceDir $m
    if (-not (Test-Path -LiteralPath $p)) {
        ERR "Missing source marker: $m (looked for $p). Build the tree first (see BUILD-EXE.md / build-complete-installer.ps1)."
    }
    OK "Found $m"
}

# -- Stage 2: preflight - 8 GB free on destination drive -----------------------
Step "Stage 2/5: Preflight disk space (need 8 GB free for output)"
try {
    $outFull  = [System.IO.Path]::GetFullPath($OutZip)
} catch {
    ERR "Cannot resolve -OutZip path '$OutZip': $($_.Exception.Message)"
}
$destRoot = [System.IO.Path]::GetPathRoot($outFull)
if ([string]::IsNullOrWhiteSpace($destRoot)) {
    ERR "Cannot determine destination drive for OutZip: $OutZip"
}
try {
    $drive = New-Object System.IO.DriveInfo($destRoot)
} catch {
    ERR "Cannot query destination drive '$destRoot': $($_.Exception.Message)"
}
$freeBytes = $drive.AvailableFreeSpace
$needBytes = 8GB
$freeGB = [math]::Round($freeBytes / 1GB, 2)
if ($freeBytes -lt $needBytes) {
    ERR "Not enough free space on $destRoot ($freeGB GB free, need 8 GB). Free up space and retry."
}
OK "Drive $destRoot has $freeGB GB free (>= 8 GB required)"

$outDir = Split-Path $outFull -Parent
if (-not [string]::IsNullOrWhiteSpace($outDir) -and -not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    OK "Created output dir: $outDir"
}

# -- Stage 3: stage to temp dir (full tree minus junk) -------------------------
Step "Stage 3/5: Stage source tree to temp dir (excluding junk)"
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("QIROVA-Portable-Stage-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Write-Host "  Source: $SourceDir" -ForegroundColor Gray
Write-Host "  Stage:  $stage" -ForegroundColor Gray
if ($IncludeVenv) { OK "IncludeVenv=ON - prebuilt backend venv ships (zero-setup portable)" }
else { WARN "IncludeVenv=OFF - excluding backend .venv (first run will need pip install)" }

try {
    $xd = @("__pycache__", ".git", "staging", ".qirova-profile", "logs")
    if (-not $IncludeVenv) { $xd += ".venv" }
    Write-Host "  Copying (robocopy /E, excluding: $($xd -join ', '), *.log) ..."
    $rbArgs = @($SourceDir, $stage, "/E", "/NFL", "/NDL", "/NJH", "/NJS",
                "/XD") + $xd + @("/XF", "*.log")
    & robocopy @rbArgs | Out-Null
    $rbExit = $LASTEXITCODE
    # robocopy exit codes 0-7 = success (copies/extras/mismatches), >= 8 = failure.
    if ($rbExit -ge 8) { ERR "robocopy failed with exit code $rbExit" }
    OK "Tree staged (robocopy exit $rbExit)"

    # Sanity: markers must survive staging.
    foreach ($m in $markers) {
        if ($m -like "*__pycache__*" -or $m -like "*.log") { continue }
        if ((-not $IncludeVenv) -and ($m -like "*.venv*")) { continue }
        $p = Join-Path $stage $m
        if (-not (Test-Path -LiteralPath $p)) { ERR "Staging lost marker: $m" }
    }
    OK "Staged markers verified"

    # -- Stage 4: PORTABLE-README.txt at zip root ------------------------------
    Step "Stage 4/5: Write PORTABLE-README.txt"
    $readme = @"
QIROVA IDE - Portable (demo-ready, zero setup)
===============================================
SIH 2026 Problem Statement PS-26164 (NTRO) - Version 1.0.0 (Portable)

HOW TO RUN (no install, no admin, runs from USB)
------------------------------------------------
1. Unzip this file anywhere (Desktop, Documents, or a USB stick).
2. Double-click QIROVA-LAUNCH.cmd
   (or QIROVA.exe if present next to it - same thing, IDE entry point).
3. That's it. The launcher starts the FastAPI backend
   (http://127.0.0.1:8000) and opens the QIROVA IDE.

WHAT'S INSIDE
-------------
- QIROVA IDE (VSCodium-based) with the qirova-ide extension preinstalled
- Python backend gateway + PREBUILT virtualenv (backend\.venv) - no pip
  install, no setup, works offline. First launch may take ~30s.
- Default profile: workspace trust off, gateway=http://localhost:8000,
  QIROVA Secure theme.

REQUIREMENTS
------------
- Windows 10 / 11, 64-bit. No admin rights needed.
- Python NOT required for the portable (venv is bundled).
- 8 GB free disk space to unzip; USB 3.0 recommended for speed.

TROUBLESHOOTING
---------------
- Status bar shows MOCK (backend not running): use QIROVA-LAUNCH.cmd,
  not VSCodium.exe directly.
- Port 8000 in use: close the other QIROVA/backend window and relaunch.
- SmartScreen/antivirus warning: this is an unsigned portable app -
  click "More info / Run anyway" or add the folder to AV exclusions.
- Moved the folder? Just relaunch - paths are relative, it runs anywhere.

BUILD INFO
----------
- Source tree : $SourceDir
- IncludeVenv : $IncludeVenv
- Built       : $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
- Docs        : see packaging/BUILD-EXE.md and build-complete-installer.ps1
  in the source repo for how this tree was produced.

License: MIT - GitHub: https://github.com/qsum99/quantum-pqc-sih2
"@
    $readmePath = Join-Path $stage "PORTABLE-README.txt"
    [System.IO.File]::WriteAllText($readmePath, ($readme -replace "`r?`n", "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    OK "Wrote PORTABLE-README.txt"

    # -- Stage 5: Compress-Archive to OutZip -----------------------------------
    Step "Stage 5/5: Compress to portable ZIP"
    if (Test-Path -LiteralPath $outFull) {
        Remove-Item -LiteralPath $outFull -Force
        WARN "Removed existing $outFull"
    }
    Write-Host "  Zipping stage -> $outFull (this may take several minutes for multi-GB trees) ..."
    Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $outFull -Force
    if (-not (Test-Path -LiteralPath $outFull)) { ERR "Compress-Archive produced no output at $outFull" }
    $zip = Get-Item -LiteralPath $outFull
    $sizeMB = [math]::Round($zip.Length / 1MB, 1)
    $sizeGB = [math]::Round($zip.Length / 1GB, 3)
    $hash = (Get-FileHash -LiteralPath $outFull -Algorithm SHA256).Hash
    OK "Wrote $outFull ($sizeMB MB / $sizeGB GB)"

    Write-Host ""
    Write-Host "  Portable ZIP : $outFull" -ForegroundColor Green
    Write-Host "  Size         : $sizeMB MB ($($zip.Length) bytes)" -ForegroundColor Green
    Write-Host "  SHA256       : $hash" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Unzip anywhere, double-click QIROVA-LAUNCH.cmd - no install, no admin." -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $stage) {
        Write-Host "  Cleaning temp stage dir ..." -ForegroundColor Gray
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
