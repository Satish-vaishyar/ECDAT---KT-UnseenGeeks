@echo off
chcp 65001 >nul 2>&1
:: QIROVA IDE + Backend Launcher
:: This launcher starts both the FastAPI backend and the VSCodium IDE.
:: It is designed to be fully portable - just double-click and go.
setlocal EnableDelayedExpansion

title QIROVA — Quantum Intelligence for PQC Migration
color 0A

set "QIROVA_HOME=%~dp0"
set "BACKEND_DIR=%QIROVA_HOME%backend"
set "VENV_DIR=%BACKEND_DIR%\.venv"
set "LOG_DIR=%QIROVA_HOME%logs"
set "BACKEND_LOG=%LOG_DIR%\backend.log"

:: Create logs dir
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo  ===============================================================
echo   QIROVA IDE — Quantum Intelligence for PQC Migration
echo   SIH 2026 PS-26164 (NTRO)
echo  ===============================================================
echo.
echo Privacy: scans stay on localhost; only approved AI calls leave your machine. Keys live in backend\.env only.
echo.

:: ── Step 1: Check Python ────────────────────────────────────────────
echo  [1/4] Checking Python...
set "PYBIN=python"
set "PORTABLE_PY=%QIROVA_HOME%python-embed\python.exe"
if not exist "%VENV_DIR%\Scripts\python.exe" if exist "%PORTABLE_PY%" (
    set "PYBIN=%PORTABLE_PY%"
    echo  [OK] Using portable Python ^(bundled^)
    goto SETUP_VENV
)
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [INFO] No system Python found. Installing Python 3.12 ^(once, per-user, no admin^)...
    set "PYSETUP=%TEMP%\qirova-python-setup.exe"
    powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' -OutFile $env:TEMP\qirova-python-setup.exe } catch { exit 1 }" >nul 2>&1
    if errorlevel 1 (
        echo  [ERROR] Download failed ^(offline?^). Install Python manually:
        echo    https://www.python.org/downloads/
        pause
        exit /b 1
    )
    echo  Installing Python silently ^(takes about a minute^)...
    "%TEMP%\qirova-python-setup.exe" /quiet InstallAllUsers=0 PrependPath=0 Include_test=0 Include_doc=0 Include_dev=0 >nul 2>&1
    del "%TEMP%\qirova-python-setup.exe" >nul 2>&1
    set "PYBIN=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    if not exist "%PYBIN%" (
        echo.
        echo  [ERROR] Automatic Python install failed.
        echo.
        echo  Please install Python 3.11 or 3.12 from:
        echo    https://www.python.org/downloads/
        echo.
        pause
        exit /b 1
    )
    echo  [OK] Python installed, continuing setup...
    echo.
    goto SETUP_VENV
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo  [OK] Python %PYVER% found
echo.

:SETUP_VENV
:: ── Step 2: Set up virtual environment ─────────────────────────────
echo  [2/4] Setting up backend environment...
if not exist "%VENV_DIR%\Scripts\python.exe" (
    echo  Creating Python virtual environment...
    "%PYBIN%" -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo  [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo  Installing backend dependencies ^(this may take 1-2 minutes on first run^)...
    "%VENV_DIR%\Scripts\pip.exe" install --quiet -r "%BACKEND_DIR%\requirements-lite.txt"
    if errorlevel 1 (
        echo  [WARN] Some packages failed to install. Retrying with basic set...
        "%VENV_DIR%\Scripts\pip.exe" install fastapi "uvicorn[standard]" pydantic requests
    )
    echo  [OK] Backend environment ready
) else (
    echo  [OK] Backend environment already set up
)
if not exist "%BACKEND_DIR%\.env" if exist "%BACKEND_DIR%\.env.example" (
    copy /y "%BACKEND_DIR%\.env.example" "%BACKEND_DIR%\.env" >nul
    echo  [OK] Created backend\.env from template ^(fill API keys for live LLM^)
)
:: ── API-key onboarding wizard (optional, never echoes key) ──────────
if not exist "%BACKEND_DIR%\.env" goto APIKEY_DONE
findstr /R "^NVIDIA_API_KEY=." "%BACKEND_DIR%\.env" >nul 2>&1
if not errorlevel 1 goto APIKEY_DONE
echo.
echo  Live LLM features need an NVIDIA API key. Free simulation works without one.
set "NVKEY="
set /p "NVKEY=Paste NVIDIA API key (Enter to skip, stays on free simulation): "
if not defined NVKEY (
    echo  [OK] No key entered - free simulation + local models remain fully working.
    goto APIKEY_DONE
)
if "!NVKEY:~0,6!"=="nvapi-" goto APIKEY_SAVE
echo  [WARN] Key did not start with nvapi- - ignored. Free simulation + local models remain fully working.
goto APIKEY_DONE
:APIKEY_SAVE
findstr /V /B "NVIDIA_API_KEY=" "%BACKEND_DIR%\.env" > "%BACKEND_DIR%\.env.tmp" 2>nul
echo NVIDIA_API_KEY=!NVKEY!>> "%BACKEND_DIR%\.env.tmp"
move /y "%BACKEND_DIR%\.env.tmp" "%BACKEND_DIR%\.env" >nul
echo  [OK] API key saved to backend\.env.
set "NVKEY="
:APIKEY_DONE
echo.

:: ── Step 3: Start the backend ───────────────────────────────────────
echo  [3/4] Starting QIROVA backend gateway...

:: Kill any lingering process on port 8000
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    echo  Releasing port 8000 ^(PID %%p^)...
    taskkill /f /pid %%p >nul 2>&1
)

:: Start backend in a hidden window (must run from backend/ so `gateway` imports)
cd /d "%BACKEND_DIR%"
start "" /min cmd /c ""%VENV_DIR%\Scripts\python.exe" -m uvicorn gateway.main:app --host 127.0.0.1 --port 8000 > "%BACKEND_LOG%" 2>&1"

:: Wait for backend to be ready (up to 60 seconds; first boot warms models)
echo  Waiting for backend to start...
set RETRY=0
:WAIT_LOOP
set /a RETRY+=1
if %RETRY% gtr 20 (
    echo.
    echo  +--------------------------------------------------------------+
    echo  ^| OFFLINE DEMO MODE                                            ^|
    echo  +--------------------------------------------------------------+
    echo  ^| backend unavailable ^(likely no network for first-time pip install^) ^|
    echo  ^| IDE starts with local detection, scoring, snippets and simulation; ^|
    echo  ^| live LLM/scan need the backend.                              ^|
    echo  +--------------------------------------------------------------+
    echo.
    goto START_IDE
)
timeout /t 1 /nobreak >nul
"%VENV_DIR%\Scripts\python.exe" -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=15)" >nul 2>&1
if errorlevel 1 goto WAIT_LOOP
echo  [OK] Backend is LIVE at http://127.0.0.1:8000
echo.

:START_IDE
:: ── Step 4: Launch the IDE ─────────────────────────────────────────
echo  [4/4] Launching QIROVA IDE...
set "ELECTRON_NO_ATTACH_CONSOLE=1"
set "USERPROFILE=%QIROVA_HOME%.qirova-profile"
if not exist "%USERPROFILE%" mkdir "%USERPROFILE%"

start "" "%QIROVA_HOME%VSCodium.exe" ^
    --disable-workspace-trust ^
    --extensions-dir "%QIROVA_HOME%resources\app\extensions" ^
    --user-data-dir "%USERPROFILE%"

echo.
echo  ===============================================================
echo   QIROVA IDE launched!
echo.
echo   Backend API:  http://127.0.0.1:8000
echo   Swagger docs: http://127.0.0.1:8000/docs
echo   Backend log:  %BACKEND_LOG%
echo.
echo   The IDE should open in a few seconds.
echo   Status bar shows LIVE when connected to the backend.
echo  ===============================================================
echo.
echo  Press any key to close this window (IDE and backend will stay running).
pause >nul
