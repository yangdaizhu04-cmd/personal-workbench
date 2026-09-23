@echo off
rem Personal Workbench launcher.
rem Serves this folder over http (needed for cross-tab sync: file:// isolates
rem localStorage per file), then opens the browser. Falls back to file:// when
rem neither node nor python is available. Keep this file ASCII-only (pitfall #017).

set PORT=8765
set URL=http://127.0.0.1:%PORT%/index.html

where node >nul 2>nul
if not errorlevel 1 (
  pushd "%~dp0"
  start "wb-server" /min node tools\dev-server.js %PORT%
  ping -n 2 127.0.0.1 >nul
  start "" "%URL%"
  popd
  exit
)

where python >nul 2>nul
if not errorlevel 1 (
  pushd "%~dp0"
  start "wb-server" /min python -m http.server %PORT% --bind 127.0.0.1
  ping -n 2 127.0.0.1 >nul
  start "" "%URL%"
  popd
  exit
)

rem Neither node nor python found: fall back to file:// (single-tab only).
start "" "%~dp0index.html"
exit
