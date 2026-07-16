@echo off
:: ============================================================================
:: sparky.bat - Single entry point for the Sparky Cart control system.
::
::   sparky start [--dev|--prod] [--sim|--real]   launch (default: --dev --sim)
::   sparky stop                                  stop the running services
::   sparky build                                 install prod deps + build UI
::   sparky update [--check]                      apply (or check for) an update
::   sparky register                              run at boot via Task Scheduler
::   sparky help                                  show this help
::
:: Everything runs through the bundled portable Node runtime — Node is never
:: assumed to be installed on the machine.
::   --dev : Vite dev server (localhost) + backend (nodemon) + PLC bridge
::   --prod: built UI served by the backend on one port, services supervised
::           (restart-on-crash), no Vite. Implies --real unless --sim is given.
:: ============================================================================
setlocal EnableDelayedExpansion

set "SCRIPT_PATH=%~f0"
set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"

:: --- shared environment defaults (formerly setup.bat) ----------------------
set "NODE_DIR=%BASE_DIR%\runtime\node-portable"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NPM_CLI=%NODE_DIR%\node_modules\npm\bin\npm-cli.js"
set "PATH=%NODE_DIR%;%PATH%"
if "%SPARKY_DATA_DIR%"=="" set "SPARKY_DATA_DIR=%BASE_DIR%\data"
if not exist "%SPARKY_DATA_DIR%" mkdir "%SPARKY_DATA_DIR%" >nul 2>&1
if "%PORT%"=="" set "PORT=3000"
if "%BRIDGE_HOST%"=="" set "BRIDGE_HOST=127.0.0.1"
if "%BRIDGE_PORT%"=="" set "BRIDGE_PORT=8000"

set "CMD=%~1"
if "%CMD%"=="" set "CMD=help"

if /I "%CMD%"=="start"        goto start
if /I "%CMD%"=="stop"         goto stop
if /I "%CMD%"=="build"        goto build
if /I "%CMD%"=="update"       goto update
if /I "%CMD%"=="register"     goto register
if /I "%CMD%"=="__supervise"  goto supervise
goto help

:: ---------------------------------------------------------------------------
:start
set "MODE=dev"
set "PLCFLAG="
shift
:parse
if "%~1"=="" goto parsed
if /I "%~1"=="--prod" set "MODE=prod"
if /I "%~1"=="--dev"  set "MODE=dev"
if /I "%~1"=="--sim"  set "PLCFLAG=sim"
if /I "%~1"=="--real" set "PLCFLAG=real"
shift
goto parse
:parsed
:: PLC mode: explicit flag wins; else prod->real, dev->sim.
if not "%PLCFLAG%"=="" (
  set "PLC_MODE=%PLCFLAG%"
) else if /I "%MODE%"=="prod" (
  set "PLC_MODE=real"
) else (
  set "PLC_MODE=sim"
)

if not exist "%NODE_EXE%" (
  echo ERROR: portable node not found at "%NODE_EXE%".
  exit /b 1
)

if /I "%MODE%"=="prod" (
  set "NODE_ENV=production"
  if not exist "%BASE_DIR%\backend\src\public\index.html" (
    echo WARNING: no built UI found. Run "sparky build" first.
  )
  echo Starting Sparky in PRODUCTION mode ^(PLC=%PLC_MODE%^)...
  :: Each service in its own supervised window. The whole cmd /k argument is a
  :: SINGLE quoted token — this is what the old start-prod.bat got wrong.
  start "Sparky PLC Bridge" cmd /k ""%SCRIPT_PATH%" __supervise bridge"
  timeout /t 2 /nobreak >nul
  start "Sparky Backend" cmd /k ""%SCRIPT_PATH%" __supervise backend"
  echo.
  echo   UI + API:   http://localhost:%PORT%
  echo   PLC bridge: http://%BRIDGE_HOST%:%BRIDGE_PORT% ^(loopback only^)
) else (
  set "NODE_ENV=development"
  echo Starting Sparky in DEVELOPMENT mode ^(PLC=%PLC_MODE%^)...
  start "Sparky PLC Bridge (%PLC_MODE%)" /d "%BASE_DIR%\microservice" "%NODE_EXE%" src\server.js
  timeout /t 1 /nobreak >nul
  start "Sparky Backend (dev)" /d "%BASE_DIR%\backend" "%NODE_EXE%" "%NPM_CLI%" run dev
  timeout /t 2 /nobreak >nul
  start "Sparky Frontend (Vite)" /d "%BASE_DIR%\frontend" "%NODE_EXE%" "%NPM_CLI%" run dev
  echo.
  echo   Frontend: http://localhost:5173
  echo   API:      http://localhost:%PORT%
  echo   Bridge:   http://%BRIDGE_HOST%:%BRIDGE_PORT% ^(%PLC_MODE%^)
)
goto end

:: --- internal: supervise one service, restarting it if it exits ------------
:supervise
set "SVC=%~2"
if /I "%SVC%"=="backend" (
  set "SVCDIR=%BASE_DIR%\backend"
) else (
  set "SVCDIR=%BASE_DIR%\microservice"
)
cd /d "%SVCDIR%"
:superviseloop
echo [%date% %time%] starting %SVC%...
"%NODE_EXE%" src\server.js
echo [%date% %time%] %SVC% exited (code %errorlevel%); restarting in 3s...
timeout /t 3 /nobreak >nul
goto superviseloop

:: ---------------------------------------------------------------------------
:stop
echo Stopping Sparky services...
taskkill /FI "WINDOWTITLE eq Sparky Backend*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Sparky PLC Bridge*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Sparky Frontend*" /T /F >nul 2>&1
echo Done.
goto end

:: ---------------------------------------------------------------------------
:build
echo Installing backend dependencies...
call "%NODE_EXE%" "%NPM_CLI%" --prefix "%BASE_DIR%\backend" ci --omit=dev || goto buildfail
echo Installing microservice dependencies...
call "%NODE_EXE%" "%NPM_CLI%" --prefix "%BASE_DIR%\microservice" ci --omit=dev || goto buildfail
echo Building frontend...
call "%NODE_EXE%" "%NPM_CLI%" --prefix "%BASE_DIR%\frontend" ci || goto buildfail
call "%NODE_EXE%" "%NPM_CLI%" --prefix "%BASE_DIR%\frontend" run build || goto buildfail
echo.
echo Build complete. Start with:  sparky start --prod
goto end
:buildfail
echo BUILD FAILED.
exit /b 1

:: ---------------------------------------------------------------------------
:: Run the updater from %TEMP% (detached) so nothing executes from inside the
:: tree being replaced. The real install root is passed via env.
:update
copy /Y "%BASE_DIR%\deploy\updater.mjs" "%TEMP%\sparky-updater.mjs" >nul
if exist "%BASE_DIR%\deploy\update.config.json" copy /Y "%BASE_DIR%\deploy\update.config.json" "%TEMP%\update.config.json" >nul
set "SPARKY_INSTALL_ROOT=%BASE_DIR%"
if /I "%~2"=="--check" (
  "%NODE_EXE%" "%TEMP%\sparky-updater.mjs" --check
) else (
  start "Sparky Update" "%NODE_EXE%" "%TEMP%\sparky-updater.mjs"
  echo Update started in a separate window; services will restart when done.
)
goto end

:: ---------------------------------------------------------------------------
:register
schtasks /Create /TN "SparkyCart" /TR "\"%BASE_DIR%\sparky.bat\" start --prod" /SC ONSTART /RL HIGHEST /F
if %errorlevel%==0 (
  echo Registered scheduled task "SparkyCart" ^(runs "sparky start --prod" at boot^).
) else (
  echo Failed to register. Run this from an elevated ^(Administrator^) prompt.
)
goto end

:: ---------------------------------------------------------------------------
:help
echo.
echo Sparky Cart launcher
echo   sparky start [--dev^|--prod] [--sim^|--real]   launch (default: --dev --sim)
echo   sparky stop                                  stop running services
echo   sparky build                                 install prod deps + build UI
echo   sparky update [--check]                      apply (or check for) an update
echo   sparky register                              run at boot (Task Scheduler)
echo.
goto end

:end
endlocal
