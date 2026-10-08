@echo off
chcp 65001 >nul 2>&1
:: QIROVA IDE - Update check (no downloads, check only)
:: Compares local extension version against remote VERSION file.
setlocal EnableDelayedExpansion

set "QUIET=0"
if /i "%~1"=="--quiet" set "QUIET=1"
if /i "%~1"=="-q" set "QUIET=1"

set "SCRIPT_DIR=%~dp0"
set "LOCAL_PKG=%SCRIPT_DIR%resources\app\extensions\qirova-ide\package.json"
if not exist "%LOCAL_PKG%" set "LOCAL_PKG=%SCRIPT_DIR%..\resources\app\extensions\qirova-ide\package.json"

set "REMOTE_URL=https://raw.githubusercontent.com/snnxndnsjdnsn/ECDAT-IDE/main/VERSION"
set "RELEASES_URL=https://github.com/snnxndnsjdnsn/ECDAT-IDE/releases"
set "TMP_LOCAL=%TEMP%\qirova_local.ver"
set "TMP_REMOTE=%TEMP%\qirova_remote.ver"

if "%QUIET%"=="0" echo.
if "%QUIET%"=="0" echo  ===============================================================
if "%QUIET%"=="0" echo   QIROVA IDE - Update check
if "%QUIET%"=="0" echo  ===============================================================
if "%QUIET%"=="0" echo.

rem -- Local version via powershell into temp file (avoids for-parens parsing) --
set "LOCAL_VER="
if exist "%LOCAL_PKG%" powershell -NoProfile -Command "(Get-Content '%LOCAL_PKG%' -Raw | ConvertFrom-Json).version" > "%TMP_LOCAL%" 2>nul
if exist "%TMP_LOCAL%" set /p LOCAL_VER=<"%TMP_LOCAL%"
if exist "%TMP_LOCAL%" del "%TMP_LOCAL%" >nul 2>&1
if defined LOCAL_VER set "LOCAL_VER=%LOCAL_VER: =%"

if not defined LOCAL_VER goto NO_LOCAL
if "%QUIET%"=="0" echo  [OK] Local version: %LOCAL_VER%
goto GOT_LOCAL
:NO_LOCAL
if "%QUIET%"=="0" echo  [WARN] Local version unknown (package.json not found).
if "%QUIET%"=="0" echo         Looked for: resources\app\extensions\qirova-ide\package.json
if "%QUIET%"=="0" echo  [WARN] Could not check (offline?): local version unreadable.
exit /b 0
:GOT_LOCAL

rem -- Remote version via powershell into temp file --
set "REMOTE_VER="
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 '%REMOTE_URL%').Content.Trim() } catch { exit 1 }" > "%TMP_REMOTE%" 2>nul
if exist "%TMP_REMOTE%" set /p REMOTE_VER=<"%TMP_REMOTE%"
if exist "%TMP_REMOTE%" del "%TMP_REMOTE%" >nul 2>&1
if defined REMOTE_VER set "REMOTE_VER=%REMOTE_VER: =%"

if defined REMOTE_VER goto GOT_REMOTE
if "%QUIET%"=="0" echo  [WARN] Could not check (offline?): remote VERSION unreachable.
if "%QUIET%"=="0" echo         %REMOTE_URL%
if "%QUIET%"=="0" echo         Check your network and try again later.
exit /b 0
:GOT_REMOTE
if "%QUIET%"=="0" echo  [OK] Remote version: %REMOTE_VER%

rem -- Compare: exit 0 means remote is newer --
powershell -NoProfile -Command "try { if ([version]'%REMOTE_VER%' -gt [version]'%LOCAL_VER%') { exit 0 } else { exit 1 } } catch { exit 2 }" >nul 2>&1
if errorlevel 2 goto CMP_FALLBACK
if errorlevel 1 goto UP_TO_DATE
goto UPDATE_FOUND

:CMP_FALLBACK
rem Non-numeric versions: plain string compare
if "%LOCAL_VER%"=="%REMOTE_VER%" goto UP_TO_DATE
goto UPDATE_FOUND

:UPDATE_FOUND
if "%QUIET%"=="1" exit /b 1
echo.
echo  [WARN] Update available: %LOCAL_VER% --to-- %REMOTE_VER%
echo.
echo  See what changed: %RELEASES_URL%
echo  To update: download the new qirova-ide-*.vsix from Releases,
echo    then replace the vsix (or copy its out/ + package.json into
echo    resources\app\extensions\qirova-ide\ per UPDATES.md).
echo.
exit /b 1

:UP_TO_DATE
if "%QUIET%"=="1" exit /b 0
echo.
echo  [OK] QIROVA IDE is up to date.
echo.
exit /b 0
