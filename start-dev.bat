@echo off
rem Seedstick dev launcher - double-click to start (hot reload enabled).
rem Keep this file ASCII-only (cmd.exe on Japanese Windows uses CP932).
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 ( echo [error] npm not found. Install Node.js first. & goto :error )
if not exist node_modules (
  echo [setup] first run: installing dependencies...
  call npm install
  if errorlevel 1 goto :error
)
call npm run dev
if errorlevel 1 goto :error
exit /b 0
:error
echo.
echo [error] Failed to start. Check the log above.
pause
exit /b 1
