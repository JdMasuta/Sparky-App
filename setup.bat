@echo off
:: setup.bat - Environment Setup Script for Portable Version
::
:: Sets PATH to the bundled portable Node runtime and non-secret defaults.
:: SECRETS (email password, admin password hash, session/bridge secrets) must
:: live ONLY in %SPARKY_DATA_DIR%\.env - never in this tracked file.

echo setup.bat: Setting up environment for Sparky Cart...
echo.

:: Paths relative to the portable app directory
set BASE_DIR=%~dp0
set NODE_PATH=%BASE_DIR%runtime\node-portable
set PATH=%NODE_PATH%;%PATH%

:: Data directory (SQLite DB, .env, logs) - kept OUTSIDE release dirs so updates
:: never clobber data. The backend loads %SPARKY_DATA_DIR%\.env on boot.
if "%SPARKY_DATA_DIR%"=="" set SPARKY_DATA_DIR=%BASE_DIR%data
if not exist "%SPARKY_DATA_DIR%" mkdir "%SPARKY_DATA_DIR%"

:: Server configuration (non-secret defaults; override in .env)
set PORT=3000
::  NODE_ENV: development | production | test  (production is set by start-prod.bat)
if "%NODE_ENV%"=="" set NODE_ENV=development
set LOG_LEVEL=info

:: PLC bridge microservice (bound to loopback; not reachable from the LAN)
if "%PLC_MODE%"=="" set PLC_MODE=real
set BRIDGE_HOST=127.0.0.1
set BRIDGE_PORT=8000

echo setup.bat: Environment ready.
echo ---------------------
echo BASE_DIR:        %BASE_DIR%
echo SPARKY_DATA_DIR: %SPARKY_DATA_DIR%
echo PORT:            %PORT%
echo NODE_ENV:        %NODE_ENV%
echo PLC_MODE:        %PLC_MODE%
echo.
:: To start the application in development, run 'start.bat'.
:: For production on the edge device, run 'deploy\start-prod.bat'.
