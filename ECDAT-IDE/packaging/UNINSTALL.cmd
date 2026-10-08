@echo off
:: QIROVA IDE Uninstaller — removes the installed payload + shortcuts.
:: - Target: %LOCALAPPDATA%\QIROVA-IDE (or %QIROVA_INSTALL_DIR% / arg override).
:: - Never deletes a drive root (same guard pattern as the installer).
:: - Confirms [Y/N] before deleting anything.
:: - Asks [Y/N] whether to also remove the user profile (.qirova-profile
::   inside the install dir, see QIROVA-LAUNCH.cmd which sets
::   USERPROFILE=%QIROVA_HOME%.qirova-profile).
:: - Usage: UNINSTALL.cmd [installed-dir]
setlocal EnableDelayedExpansion

title QIROVA IDE - Uninstall...
color 0E

if "%~1" neq "" (
  set "DEST=%~1"
) else if defined QIROVA_INSTALL_DIR (
  set "DEST=%QIROVA_INSTALL_DIR%"
) else (
  set "DEST=%LOCALAPPDATA%\QIROVA-IDE"
)

echo.
echo  ============================================================
echo   QIROVA IDE - Uninstaller
echo   SIH 2026 PS-26164 (NTRO)
echo  ============================================================
echo.
echo  Target: %DEST%
echo.

:: --- Guard: never touch a drive root ---
for %%D in (A B C D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
  if /i "%DEST%"=="%%D:" goto :BAD_DEST
  if /i "%DEST%"=="%%D:\" goto :BAD_DEST
)
:: --- Extra safety: never delete bare profile/appdata roots ---
if not defined DEST goto :BAD_DEST
if /i "%DEST%"=="%LOCALAPPDATA%" goto :BAD_DEST
if /i "%DEST%"=="%USERPROFILE%" goto :BAD_DEST
if /i "%DEST%"=="%APPDATA%" goto :BAD_DEST

set "DSHORTCUT=%USERPROFILE%\Desktop\QIROVA IDE.lnk"
set "SSHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\QIROVA IDE.lnk"

if not exist "%DEST%" (
  echo  [INFO] Nothing to uninstall: "%DEST%" does not exist.
  echo         Cleaning up shortcuts only.
  echo.
) else (
  echo  This will delete:
  echo    - Install dir : %DEST%
  echo    - Desktop shortcut : "%DSHORTCUT%"
  echo    - Start Menu entry : "%SSHORTCUT%"
  echo.
)

:: --- Confirm before deleting anything ---
set "CONFIRM="
set /p CONFIRM="  Uninstall QIROVA IDE now? [Y/N]: "
if /i "!CONFIRM!" neq "Y" (
  echo  Uninstall cancelled. Nothing was deleted.
  pause
  exit /b 0
)

:: --- Ask about the user profile inside the install dir ---
set "REMOVEPROFILE="
set /p REMOVEPROFILE="  Also remove user profile (.qirova-profile inside install dir)? [Y/N]: "
if /i "!REMOVEPROFILE!"=="Y" (
  set "KEEP_PROFILE=N"
) else (
  set "KEEP_PROFILE=Y"
)

if exist "%DEST%" (
  if /i "!KEEP_PROFILE!"=="N" (
    echo  Removing "%DEST%" ...
    rmdir /s /q "%DEST%" 2>nul
    if not exist "%DEST%" (
      echo  [OK] Install dir removed.
    ) else (
      echo  [ERROR] Could not fully remove "%DEST%". Check open files/locks.
      pause
      exit /b 1
    )
  ) else (
    if exist "%DEST%\.qirova-profile" (
      echo  Preserving profile: "%DEST%\.qirova-profile"
      echo  Removing everything else inside "%DEST%" ...
      for /f "delims=" %%F in ('dir "%DEST%" /b /a 2^>nul') do (
        if /i not "%%F"==".qirova-profile" (
          if exist "%DEST%\%%F\" (
            rmdir /s /q "%DEST%\%%F" 2>nul
          ) else (
            del /f /q "%DEST%\%%F" 2>nul
          )
        )
      )
      echo  [OK] App files removed; profile kept at "%DEST%\.qirova-profile".
    ) else (
      echo  Removing "%DEST%" ...
      rmdir /s /q "%DEST%" 2>nul
      if not exist "%DEST%" (
        echo  [OK] Install dir removed - no profile was present.
      ) else (
        echo  [ERROR] Could not fully remove "%DEST%". Check open files/locks.
        pause
        exit /b 1
      )
    )
  )
) else (
  echo  [INFO] Install dir already gone.
)

if exist "%DSHORTCUT%" (
  del /f /q "%DSHORTCUT%" 2>nul
  if not exist "%DSHORTCUT%" (
    echo  [OK] Desktop shortcut removed.
  ) else (
    echo  [WARN] Could not remove desktop shortcut.
  )
) else (
  echo  [INFO] No desktop shortcut found.
)

if exist "%SSHORTCUT%" (
  del /f /q "%SSHORTCUT%" 2>nul
  if not exist "%SSHORTCUT%" (
    echo  [OK] Start Menu entry removed.
  ) else (
    echo  [WARN] Could not remove Start Menu entry.
  )
) else (
  echo  [INFO] No Start Menu entry found.
)

echo.
echo  ============================================================
echo   UNINSTALL COMPLETE.
echo  ============================================================
echo.
pause
exit /b 0

:BAD_DEST
echo.
echo  [FATAL] Refusing to uninstall "%DEST%".
echo          Target must be a real folder, not a drive root
echo          ^(and not a bare system folder^). Nothing was deleted.
echo.
pause
exit /b 2
