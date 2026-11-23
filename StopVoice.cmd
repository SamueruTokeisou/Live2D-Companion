@echo off
cd /d "%~dp0"
if not exist "runtime\voice-tools\Scripts\python.exe" exit /b 1
"runtime\voice-tools\Scripts\python.exe" tools\voice_service.py stop
if errorlevel 1 pause
