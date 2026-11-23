@echo off
cd /d "%~dp0"
if not exist "runtime\voice-tools\Scripts\python.exe" (
 echo Voice environment is not installed. See docs/public/P5_VOICE_SELECTION.md
 pause
 exit /b 1
)
"runtime\voice-tools\Scripts\python.exe" tools\voice_service.py start
if errorlevel 1 pause
