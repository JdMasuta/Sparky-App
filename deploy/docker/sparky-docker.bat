@echo off
:: ============================================================================
:: sparky-docker.bat - Sparky Cart container deployment helper (#25).
:: No PowerShell. Everything except the Windows-only steps runs inside the
:: sparky-host WSL distro via wsl\setup-host.sh.
::
::   sparky-docker wsl-setup              create sparky-host, install Docker CE
::   sparky-docker install                start proxy + orchestrator (+ app)
::   sparky-docker import-data <dir> [real^|sim]   copy a native data dir in
::   sparky-docker set-admin-password     change the admin password
::   sparky-docker status ^| logs [proxy^|orchestrator^|app] ^| start ^| stop
::   sparky-docker upgrade-edge <image@sha256:...>
::   sparky-docker register-boot          (elevated) start at boot, before login
::   sparky-docker register-logon         start at logon (no admin needed)
::   sparky-docker portproxy-refresh      (elevated) LAN port-forward to WSL
::   sparky-docker boot                   used by the boot/logon entries
::
:: SPARKY_ENGINE=wsl (default) or desktop. With desktop, set SPARKY_DISTRO to
:: a distro that has Docker Desktop WSL integration enabled.
:: ============================================================================
setlocal EnableDelayedExpansion

set "DOCKER_DIR=%~dp0"
set "DOCKER_DIR=%DOCKER_DIR:~0,-1%"
if "%SPARKY_ENGINE%"=="" set "SPARKY_ENGINE=wsl"
if "%SPARKY_DISTRO%"=="" set "SPARKY_DISTRO=sparky-host"
if "%SPARKY_HTTP_PORT%"=="" set "SPARKY_HTTP_PORT=3000"
set "KEEPALIVE=/usr/local/sbin/sparky-keepalive"

set "CMD=%~1"
if "%CMD%"=="" goto help
if /I "%CMD%"=="help"              goto help
if /I "%CMD%"=="wsl-setup"         goto wslsetup
if /I "%CMD%"=="register-boot"     goto registerboot
if /I "%CMD%"=="register-logon"    goto registerlogon
if /I "%CMD%"=="portproxy-refresh" goto portproxy
if /I "%CMD%"=="boot"              goto boot
if /I "%CMD%"=="import-data"       goto importdata
goto inhost

:: --- everything else runs inside the distro ------------------------------------
:inhost
wsl.exe -d %SPARKY_DISTRO% -u root --cd "%DOCKER_DIR%" -- bash wsl/setup-host.sh %*
exit /b %errorlevel%

:importdata
:: Translate the Windows path for the distro.
if "%~2"=="" (
  echo Usage: sparky-docker import-data ^<native data dir^> [real^|sim]
  exit /b 1
)
for /f "usebackq delims=" %%P in (`wsl.exe -d %SPARKY_DISTRO% -u root -- wslpath -a "%~f2"`) do set "SRC=%%P"
wsl.exe -d %SPARKY_DISTRO% -u root --cd "%DOCKER_DIR%" -- bash wsl/setup-host.sh import-data "!SRC!" %3
exit /b %errorlevel%

:: --- WSL distro + Docker CE ---------------------------------------------------
:wslsetup
if /I "%SPARKY_ENGINE%"=="desktop" (
  echo SPARKY_ENGINE=desktop: Docker Desktop provides the engine; skipping wsl-setup.
  exit /b 0
)
wsl.exe -d %SPARKY_DISTRO% -u root -- true >nul 2>&1
if errorlevel 1 (
  echo Creating WSL distro %SPARKY_DISTRO% ^(Debian^)...
  wsl.exe --install -d Debian --name %SPARKY_DISTRO% --no-launch
  if errorlevel 1 (
    echo Could not create %SPARKY_DISTRO%. On older WSL versions, import a Debian rootfs instead:
    echo   wsl --import %SPARKY_DISTRO% "%LOCALAPPDATA%\Sparky\wsl" debian-rootfs.tar
    exit /b 1
  )
)
if not exist "C:\SparkyData\backups" mkdir "C:\SparkyData\backups"
wsl.exe -d %SPARKY_DISTRO% -u root --cd "%DOCKER_DIR%" -- bash wsl/setup-host.sh engine
if errorlevel 1 exit /b 1
:: Restart the distro so /etc/wsl.conf (systemd) takes effect, then keep it up.
wsl.exe --terminate %SPARKY_DISTRO%
start "Sparky WSL" /min wsl.exe -d %SPARKY_DISTRO% -u root -- %KEEPALIVE%
echo.
echo Next: set the image digests in /etc/sparky/edge.env, then run
echo   sparky-docker import-data ^<native data dir^> real
echo   sparky-docker install
echo   sparky-docker register-boot   ^(elevated^)  or  register-logon
exit /b 0

:: --- start at boot / logon --------------------------------------------------------
:boot
:: Keep the distro (and so dockerd) running; Docker restarts the containers.
start "Sparky WSL" /min wsl.exe -d %SPARKY_DISTRO% -u root -- %KEEPALIVE%
if /I "%SPARKY_PORTPROXY%"=="1" (
  timeout /t 15 /nobreak >nul
  call "%~f0" portproxy-refresh
)
exit /b 0

:registerboot
:: Runs as the current user (WSL distros are per-user) whether or not anyone
:: logs in. /RP * prompts for the account password; needs an elevated prompt.
schtasks /Create /TN "SparkyBoot" /SC ONSTART /RU "%USERDOMAIN%\%USERNAME%" /RP * /RL HIGHEST /F ^
  /TR "\"%~f0\" boot"
if errorlevel 1 (
  echo Failed. Run this from an elevated ^(Administrator^) prompt, or use register-logon.
  exit /b 1
)
echo Registered "SparkyBoot": Sparky starts at boot, before anyone logs in.
echo For the port-forward method, also set SPARKY_PORTPROXY=1 as a system environment variable.
exit /b 0

:registerlogon
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\sparky-wsl.cmd" echo @start "Sparky WSL" /min wsl.exe -d %SPARKY_DISTRO% -u root -- %KEEPALIVE%
echo Created "%STARTUP%\sparky-wsl.cmd": Sparky starts when this user logs in.
exit /b 0

:: --- LAN access through a Windows port-forward (when not using mirrored mode) ---
:portproxy
set "WSLIP="
for /f "tokens=1" %%I in ('wsl.exe -d %SPARKY_DISTRO% -u root -- hostname -I') do if not defined WSLIP set "WSLIP=%%I"
if "%WSLIP%"=="" (
  echo Could not read the %SPARKY_DISTRO% IP address. Is the distro running?
  exit /b 1
)
netsh interface portproxy delete v4tov4 listenport=%SPARKY_HTTP_PORT% listenaddress=0.0.0.0 >nul 2>&1
netsh interface portproxy add v4tov4 listenport=%SPARKY_HTTP_PORT% listenaddress=0.0.0.0 connectport=%SPARKY_HTTP_PORT% connectaddress=%WSLIP%
if errorlevel 1 (
  echo portproxy failed. Run from an elevated prompt.
  exit /b 1
)
netsh advfirewall firewall show rule name="Sparky HTTP" >nul 2>&1
if errorlevel 1 netsh advfirewall firewall add rule name="Sparky HTTP" dir=in action=allow protocol=TCP localport=%SPARKY_HTTP_PORT% >nul
echo LAN :%SPARKY_HTTP_PORT% now forwards to %SPARKY_DISTRO% at %WSLIP%.
exit /b 0

:help
echo.
echo Sparky Cart container deployment
echo   sparky-docker wsl-setup ^| install ^| import-data ^<dir^> [real^|sim]
echo   sparky-docker set-admin-password ^| status ^| logs [proxy^|orchestrator^|app]
echo   sparky-docker start ^| stop ^| upgrade-edge ^<image@sha256:...^>
echo   sparky-docker register-boot ^(elevated^) ^| register-logon ^| portproxy-refresh ^(elevated^)
echo.
exit /b 0
