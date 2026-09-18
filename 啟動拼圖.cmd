@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3 is required. Install it or serve this folder with any local HTTP server.
  pause
  exit /b 1
)
python launch.py
if errorlevel 1 pause
