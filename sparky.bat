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
:: Presence of this file tells the supervise loops to exit instead of
:: restarting node (set by :stop, cleared by :start).
set "STOP_FLAG=%SPARKY_DATA_DIR%\.stopping"
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
:: Clear any stale stop-flag before launching, or the supervise loops would
:: see it and exit immediately.
del "%STOP_FLAG%" >nul 2>&1
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
:: NOTE: deliberately no `cd` into %SVCDIR% — that would make this cmd hold the
:: service dir as its cwd and block the updater from renaming it. The services
:: resolve all paths via __dirname/env, so cwd is irrelevant; run node by
:: absolute path instead.
:superviseloop
:: :stop drops STOP_FLAG to end this loop deterministically (window titles are
:: mutated by cmd /k while node runs, so they can't be matched reliably).
if exist "%STOP_FLAG%" exit
echo [%date% %time%] starting %SVC%...
"%NODE_EXE%" "%SVCDIR%\src\server.js"
echo [%date% %time%] %SVC% exited (code %errorlevel%); restarting in 3s...
if exist "%STOP_FLAG%" exit
timeout /t 3 /nobreak >nul
goto superviseloop

:: ---------------------------------------------------------------------------
:stop
echo Stopping Sparky services...
:: Signal the supervise loops to exit instead of relaunching node. Set this
:: BEFORE killing so a loop that's mid-restart sees it rather than racing.
:: :start clears it again.
type nul > "%STOP_FLAG%" 2>nul
:: Primary kill: by listening port. cmd /k mutates each window's title to
:: "Sparky Backend - <command>" while node runs, so the WINDOWTITLE filter
:: below misses live services — the port is the stable identifier.
for %%P in (%PORT% %BRIDGE_PORT%) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /C:":%%P " ^| findstr "LISTENING"') do taskkill /F /T /PID %%I >nul 2>&1
)
:: Secondary (best-effort): title-based kill. Still useful for the dev-mode
:: Vite window, which has no fixed port variable. /T tree-kills descendants —
:: nothing that must survive a stop may be launched under these windows (see
:: the stage-1 hand-off in deploy\updater.mjs).
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
:: --include=dev overrides npm's `omit` default, which silently becomes
:: ["dev"] whenever NODE_ENV=production is set in the environment (e.g. left
:: over from `sparky start --prod` in the same shell) — without this flag
:: that config skips vite/@vitejs/plugin-react entirely and `run build` below
:: fails for lack of the vite binary.
call "%NODE_EXE%" "%NPM_CLI%" --prefix "%BASE_DIR%\frontend" ci --include=dev || goto buildfail
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
:: The non-check run is stage 1 of the updater: it returns immediately after
:: relaunching itself detached and console-less, so `sparky stop`'s
:: taskkill /T tree-kill can never reach it (dead parent, no window title).
if /I "%~2"=="--check" (
  "%NODE_EXE%" "%TEMP%\sparky-updater.mjs" --check
) else (
  "%NODE_EXE%" "%TEMP%\sparky-updater.mjs"
  echo Update running in the background ^(log: %TEMP%\sparky-updater.log^); services will restart when done.
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
