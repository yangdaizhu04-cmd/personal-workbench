@echo off
rem Build single-file HTML (requires Node.js)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)
node build.js
echo.
echo Done. Single-file build updated.
pause
