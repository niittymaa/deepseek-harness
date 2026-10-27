@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" %*
set SCRIPT_EXIT_CODE=%ERRORLEVEL%

echo.
if %SCRIPT_EXIT_CODE% neq 0 (
    echo [!] Launcher exited with error code %SCRIPT_EXIT_CODE%.
) else (
    echo [i] Launcher process finished.
)
echo.
echo Press any key to close this window...
pause >nul
