@echo off
:: QIROVA IDE Installer — hardened against wrong-source copies.
:: - Verifies the source tree is a real QIROVA payload (marker files) before
::   copying ANYTHING, so a misplaced script can never clone a whole drive.
:: - Refuses drive-root sources (D:\, C:\) outright.
:: - Installs to %LOCALAPPDATA%\QIROVA-IDE (stable across cleanups; %TEMP%
::   may be wiped by Windows, which used to break installs).
:: - Usage: install-7z.cmd [destination-dir]
setlocal EnableDelayedExpansion

title QIROVA IDE - Installing...
color 0A

set "INST_ROOT=%~dp0"
:: strip trailing backslash for reliable comparisons
if "%INST_ROOT:~-1%"=="\" set "INST_ROOT=%INST_ROOT:~0,-1%"

if "%~1" neq "" (
  set "DEST=%~1"
) else if defined QIROVA_INSTALL_DIR (
  set "DEST=%QIROVA_INSTALL_DIR%"
) else (
  set "DEST=%LOCALAPPDATA%\QIROVA-IDE"
)

echo.
echo  ============================================================
echo   QIROVA IDE 1.0.0 - Complete Installer
echo   SIH 2026 PS-26164 (NTRO)
echo  ============================================================
echo.

echo  [0/3] Verifying installation source...
echo        Source: %INST_ROOT%
:: --- Guard 1: never copy from a drive root (this cloned whole drives) ---
for %%D in (A B C D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
  if /i "%INST_ROOT%"=="%%D:" goto :BAD_SOURCE_ROOT
  if /i "%INST_ROOT%"=="%%D:\" goto :BAD_SOURCE_ROOT
)
:: --- Guard 2: marker files must exist (proves this is a QIROVA payload) ---
if not exist "%INST_ROOT%\VSCodium.exe" goto :BAD_SOURCE_MARKER
if not exist "%INST_ROOT%\backend\gateway\main.py" goto :BAD_SOURCE_MARKER
if not exist "%INST_ROOT%\resources\app\extensions\qirova-ide\package.json" goto :BAD_SOURCE_MARKER
echo   [OK] Valid QIROVA payload found.
echo.

:: --- Guard 3: destination must not be a drive root or the source itself ---
for %%D in (A B C D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
  if /i "%DEST%"=="%%D:" goto :BAD_DEST
  if /i "%DEST%"=="%%D:\" goto :BAD_DEST
)
if /i "%DEST%"=="%INST_ROOT%" goto :BAD_DEST
echo  Target: %DEST%
echo.

:: Check if already installed at destination
if exist "%DEST%\VSCodium.exe" (
  echo  [INFO] QIROVA IDE is already installed at:
  echo         %DEST%
  echo.
  set /p CHOICE="  Overwrite? [Y/N]: "
  if /i "!CHOICE!" neq "Y" (
    echo  Opening existing installation...
    start "" "%DEST%\QIROVA-LAUNCH.cmd"
    exit /b 0
  )
)

echo  [Preflight] Checking system requirements...
echo        Checking free disk space (needs 8 GB free)...
:: Powershell one-liner: free GB on the DEST drive -> temp file (avoids for/f paren escaping)
powershell -NoProfile -Command "& { $drv='%DEST:~0,1%'; try { $v=(Get-PSDrive $drv -ErrorAction Stop).Free; $g=[math]::Floor($v/1GB); Write-Output $g } catch { Write-Output -1 } } | Out-File -Encoding ascii '%TEMP%\qirova-free.txt'" 2>nul
set "FREEGB=-1"
if exist "%TEMP%\qirova-free.txt" set /p FREEGB=<"%TEMP%\qirova-free.txt" 2>nul
del "%TEMP%\qirova-free.txt" 2>nul
:: trim spaces from FREEGB
set "FREEGB=!FREEGB: =!"
if not defined FREEGB set "FREEGB=-1"
echo        Free space on %DEST:~0,2% !FREEGB! GB
if "!FREEGB!"=="-1" (
  echo  [WARN] Could not determine free disk space. Continuing anyway.
) else if !FREEGB! LSS 8 (
  echo  [ERROR] Not enough free disk space on %DEST:~0,2% ^(!FREEGB! GB free, need 8 GB^).
  echo          Free up space and try again. Nothing was copied.
  pause
  exit /b 1
)
echo        Checking memory (needs 8 GB RAM, warning only)...
powershell -NoProfile -Command "& { try { $m=(Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory; $g=[math]::Floor($m/1GB); Write-Output $g } catch { Write-Output -1 } } | Out-File -Encoding ascii '%TEMP%\qirova-ram.txt'" 2>nul
set "RAMGB=-1"
if exist "%TEMP%\qirova-ram.txt" set /p RAMGB=<"%TEMP%\qirova-ram.txt" 2>nul
del "%TEMP%\qirova-ram.txt" 2>nul
set "RAMGB=!RAMGB: =!"
if not defined RAMGB set "RAMGB=-1"
if "!RAMGB!"=="-1" (
  echo  [WARN] Could not determine RAM size. Continuing anyway.
) else if !RAMGB! LSS 8 (
  echo  [WARN] Only !RAMGB! GB RAM detected. QIROVA IDE recommends 8 GB or more.
  echo         Continuing anyway...
) else (
  echo        RAM: !RAMGB! GB [OK]
)
echo        Checking port 8000...
netstat -ano 2>nul | findstr ":8000 " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo  [WARN] Port 8000 is already LISTENING ^(maybe Jupyter or another service^).
  echo         The installer will NOT stop it.
  set "PORTCHOICE="
  set /p PORTCHOICE="  Proceed with install anyway? [Y/N]: "
  if /i "!PORTCHOICE!" neq "Y" (
    echo  Installation cancelled by user. Nothing was copied.
    pause
    exit /b 0
  )
) else (
  echo        Port 8000 is free [OK]
)
echo  [OK] Preflight checks done.
echo.

echo  [1/3] Preparing installation directory...
if not exist "%DEST%" md "%DEST%" 2>nul
if not exist "%DEST%" (
  echo  [ERROR] Cannot create %DEST%. Check permissions/disk space.
  pause
  exit /b 1
)
echo.

echo  [2/3] Copying QIROVA IDE files...
:: Copy payload to DEST (never the reverse; DEST was validated above)
:: Staged copy with visible progress: robocopy cannot show %, so copy per
:: top-level group (backend, resources, root/VSCodium files, remaining) with
:: [x/4] headers and per-step file counts. All paths quoted for robustness.
echo        Counting files (this takes a few seconds)...
set "TOTALFILES=0"
for /f %%C in ('dir "%INST_ROOT%" /s /b /a-d 2^>nul ^| find /c /v ""') do set "TOTALFILES=%%C"
echo        Found !TOTALFILES! files to install.
echo.
if exist "%INST_ROOT%\backend" (
  set "CNT_BACKEND=0"
  for /f %%C in ('dir "%INST_ROOT%\backend" /s /b /a-d 2^>nul ^| find /c /v ""') do set "CNT_BACKEND=%%C"
  echo  [1/4] Copying backend ^(!CNT_BACKEND! files^)...
  robocopy "%INST_ROOT%\backend" "%DEST%\backend" /E /NFL /NDL /NJH /NJS /XD "__pycache__" ".git" 2>nul
  if errorlevel 8 goto :COPY_FAIL
) else (
  echo  [1/4] Skipping backend ^(not present^)...
)
if exist "%INST_ROOT%\resources" (
  set "CNT_RES=0"
  for /f %%C in ('dir "%INST_ROOT%\resources" /s /b /a-d 2^>nul ^| find /c /v ""') do set "CNT_RES=%%C"
  echo  [2/4] Copying resources ^(!CNT_RES! files^)...
  robocopy "%INST_ROOT%\resources" "%DEST%\resources" /E /NFL /NDL /NJH /NJS /XD "__pycache__" ".git" 2>nul
  if errorlevel 8 goto :COPY_FAIL
) else (
  echo  [2/4] Skipping resources ^(not present^)...
)
set "CNT_ROOT=0"
for /f %%C in ('dir "%INST_ROOT%" /b /a-d 2^>nul ^| find /c /v ""') do set "CNT_ROOT=%%C"
echo  [3/4] Copying VSCodium + root files ^(!CNT_ROOT! files^)...
robocopy "%INST_ROOT%" "%DEST%" *.* /LEV:1 /NFL /NDL /NJH /NJS /XF "install.cmd" "sfx-config.txt" "install-7z.cmd" 2>nul
if errorlevel 8 goto :COPY_FAIL
echo  [4/4] Syncing remaining files and folders ^(of !TOTALFILES! total, skipping up-to-date^)...
robocopy "%INST_ROOT%" "%DEST%" /E /NFL /NDL /NJH /NJS /XD "__pycache__" ".git" "backend" "resources" /XF "install.cmd" "sfx-config.txt" "install-7z.cmd" 2>nul
if errorlevel 8 goto :COPY_FAIL
if not exist "%DEST%\VSCodium.exe" (
  echo  [ERROR] Copy finished but VSCodium.exe is missing at destination. Aborted.
  set "CLEANUP2="
  set /p CLEANUP2="  Remove partial install at %DEST%? [Y/N]: "
  if /i "!CLEANUP2!"=="Y" call :DO_ROLLBACK
  pause
  exit /b 1
)
echo  [OK] Files installed to %DEST%
echo.
goto :AFTER_COPY

:COPY_FAIL
echo  [ERROR] Failed to copy files. Check disk space (needs ~2 GB free).
set "CLEANUP="
set /p CLEANUP="  Remove partial install at %DEST%? [Y/N]: "
if /i "!CLEANUP!"=="Y" call :DO_ROLLBACK
pause
exit /b 1

:DO_ROLLBACK
:: Safety: never delete a drive root even if DEST was mangled
for %%D in (A B C D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
  if /i "%DEST%"=="%%D:" exit /b 0
  if /i "%DEST%"=="%%D:\" exit /b 0
)
if not exist "%DEST%" exit /b 0
echo        Removing partial install: %DEST%
rmdir /s /q "%DEST%" 2>nul
if not exist "%DEST%" echo        Partial install removed.
exit /b 0

:AFTER_COPY

echo  [3/3] Creating shortcut on Desktop...
set "SHORTCUT=%USERPROFILE%\Desktop\QIROVA IDE.lnk"
powershell -NoProfile -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath='%DEST%\QIROVA-LAUNCH.cmd'; $s.WorkingDirectory='%DEST%'; $s.Description='QIROVA IDE - Quantum Intelligence for PQC Migration'; $s.IconLocation='%DEST%\VSCodium.exe,0'; $s.Save()" 2>nul
if exist "%SHORTCUT%" (
  echo  [OK] Desktop shortcut created: QIROVA IDE.lnk
) else (
  echo  [INFO] Could not create shortcut ^(non-critical^)
)
echo  Creating Start Menu entry...
set "STARTDIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
if not exist "%STARTDIR%" md "%STARTDIR%" 2>nul
set "STARTSHORTCUT=%STARTDIR%\QIROVA IDE.lnk"
powershell -NoProfile -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%STARTSHORTCUT%'); $s.TargetPath='%DEST%\QIROVA-LAUNCH.cmd'; $s.WorkingDirectory='%DEST%'; $s.Description='QIROVA IDE - Quantum Intelligence for PQC Migration'; $s.IconLocation='%DEST%\VSCodium.exe,0'; $s.Save()" 2>nul
if exist "%STARTSHORTCUT%" (
  echo  [OK] Start Menu entry created: QIROVA IDE
) else (
  echo  [INFO] Could not create Start Menu entry ^(non-critical^)
)
echo.
echo  ============================================================
echo   INSTALLATION COMPLETE!
echo.
echo   Location: %DEST%
echo.
echo   First launch downloads Python packages automatically
echo   (needs internet once, ~1-2 minutes), then everything runs.
echo.
echo   TO LAUNCH:
echo     Double-click "QIROVA IDE" on your Desktop
echo.
echo   NOTE: Python 3.11 or 3.12 must be installed.
echo   Download: https://www.python.org/downloads/
echo   (Check "Add Python to PATH" during install)
echo  ============================================================
echo.
set /p LAUNCH="  Launch QIROVA IDE now? [Y/N]: "
if /i "%LAUNCH%" equ "Y" (
  echo  Starting QIROVA IDE...
  start "" "%DEST%\QIROVA-LAUNCH.cmd"
)
echo.
pause
exit /b 0

:BAD_SOURCE_ROOT
echo.
echo  [FATAL] Refusing to install: source is a drive root (%INST_ROOT%).
echo          Run this installer from the extracted QIROVA folder, not from
echo          a drive root. Nothing was copied.
echo.
pause
exit /b 2

:BAD_SOURCE_MARKER
echo.
echo  [FATAL] Refusing to install: %INST_ROOT%
echo          does not look like a QIROVA payload (missing VSCodium.exe,
echo          backend\gateway\main.py or the qirova-ide extension).
echo          Nothing was copied.
echo.
pause
exit /b 2

:BAD_DEST
echo.
echo  [FATAL] Refusing to install to "%DEST%".
echo          Destination must be a real folder, not a drive root,
echo          and not the source folder itself. Nothing was copied.
echo.
pause
exit /b 2
