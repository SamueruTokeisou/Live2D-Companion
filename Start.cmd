@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo Please run Setup.ps1 first. Python 3.11 or newer is required.
  pause
  exit /b 1
)
start "" ".venv\Scripts\pythonw.exe" "tools\pet_manager.py"
