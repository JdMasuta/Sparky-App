@echo off
:: start-prod.bat - Production launcher for the Sparky edge device.
::
:: Serves the pre-built frontend from the backend on a single port (no Vite dev
:: server, no --host), runs the PLC bridge on loopback, and supervises both with
:: a restart-on-crash loop. Uses ONLY the bundled portable Node runtime.
::
:: Prerequisites: `npm run build` has produced backend\src\public, and deps are
:: installed (npm ci) in backend\ and microservice\.

setlocal
set BASE_DIR=%~dp0..
call "%BASE_DIR%\setup.bat"

:: Force production settings regardless of setup.bat defaults.
set NODE_ENV=production
if "%PLC_MODE%"=="" set PLC_MODE=real

set NODE_EXE=%BASE_DIR%\runtime\node-portable\node.exe
if not exist "%NODE_EXE%" (
  echo ERROR: portable node not found at %NODE_EXE%
  exit /b 1
)

if not exist "%BASE_DIR%\backend\src\public\index.html" (
  echo WARNING: no built frontend found at backend\src\public. Run "npm run build" in frontend first.
)

echo Starting PLC bridge (mode=%PLC_MODE%) and backend in production mode...

:: Each service runs in its own supervised window that restarts it if it exits.
start "Sparky PLC Bridge" cmd /k "%BASE_DIR%\deploy\run-supervised.bat" "%BASE_DIR%\microservice" "%NODE_EXE%" "src\server.js"
timeout /t 2 /nobreak > nul
start "Sparky Backend" cmd /k "%BASE_DIR%\deploy\run-supervised.bat" "%BASE_DIR%\backend" "%NODE_EXE%" "src\server.js"

echo.
echo Sparky Cart is starting.
echo   Backend + UI: http://localhost:%PORT%
echo   PLC bridge:   http://127.0.0.1:%BRIDGE_PORT% (loopback only)
endlocal
