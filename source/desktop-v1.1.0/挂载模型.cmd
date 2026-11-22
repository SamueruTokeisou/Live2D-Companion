@echo off
chcp 936 >nul
setlocal
set "ELECTRON_RUN_AS_NODE=1"
rem 用通配找 exe，避免在批处理里写中文字面量（GBK/UTF-8 混码会变乱码路径）
for %%x in ("%~dp0*.exe") do set "APP=%%~fx"
if not defined APP (
  echo [ERROR] 找不到 exe，请把本文件放在程序目录里再运行。
  pause
  exit /b 2
)
set "MODEL=%~1"
set "HOME_DIR=%~2"
if "%MODEL%"=="" set /p MODEL=把 xxx.model3.json 拖进来（或输入完整路径）后回车：
if "%MODEL%"=="" (
  echo [ERROR] 没有输入路径。
  pause
  exit /b 2
)

if "%HOME_DIR%"=="" (
  "%APP%" "%~dp0resources\app\tools\mount-model.mjs" "%MODEL%"
) else (
  "%APP%" "%~dp0resources\app\tools\mount-model.mjs" "%MODEL%" --home "%HOME_DIR%"
)
set "RC=%ERRORLEVEL%"
chcp 936 >nul

echo.
if not "%RC%"=="0" (
  echo [ERROR] 挂载失败（退出码 %RC%）。看上面的提示；路径不要带引号。
  rem 拖文件进来时没有 pause，失败一闪就没 —— 这里补上，让用户能看清原因
  pause
  exit /b %RC%
)
echo [OK] 模型已挂载；若桌宠正在运行，请先退出再重新打开。
if "%~1"=="" pause
exit /b 0
