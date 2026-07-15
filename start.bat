@echo off
:: start.bat - DEVELOPMENT launcher (local machine only).
::
:: Launches the PLC bridge (simulator), the backend (nodemon), and the Vite dev
:: server bound to localhost. For the edge device / production, use
:: deploy\start-prod.bat instead (built frontend served by the backend, no Vite,
:: services supervised). All Node runs from the bundled portable runtime.

set BASE_DIR=%~dp0
if exist "%BASE_DIR%setup.bat" call "%BASE_DIR%setup.bat"
set NODE_ENV=development
if "%PLC_MODE%"=="" set PLC_MODE=sim

set NODE_EXE=%BASE_DIR%runtime\node-portable\node.exe
set NPM_CLI=%BASE_DIR%runtime\node-portable\node_modules\npm\bin\npm-cli.js

if not exist "%NODE_EXE%" (
  echo ERROR: portable node not found at %NODE_EXE%
  pause
  exit /b 1
)

echo Starting PLC bridge (simulator)...
start "Sparky PLC Bridge (sim)" cmd /k "cd /d %BASE_DIR%microservice && "%NODE_EXE%" src\server.js"

timeout /t 1 /nobreak > nul
echo Starting backend (dev)...
start "Sparky Backend (dev)" cmd /k "cd /d %BASE_DIR%backend && "%NODE_EXE%" "%NPM_CLI%" run dev"

timeout /t 2 /nobreak > nul
echo Starting frontend (Vite dev, localhost)...
start "Sparky Frontend (dev)" cmd /k "cd /d %BASE_DIR%frontend && "%NODE_EXE%" "%NPM_CLI%" run dev"

echo.
echo Development servers starting:
echo   Frontend (Vite): http://localhost:5173
echo   Backend API:     http://localhost:3000
echo   PLC bridge:      http://127.0.0.1:8000 (sim)
