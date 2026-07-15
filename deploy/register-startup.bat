@echo off
:: register-startup.bat - Register Sparky to launch at machine startup via the
:: built-in Windows Task Scheduler (no software install required).
::
:: Run once, from an elevated prompt. Creates a task that runs start-prod.bat
:: at system startup. Remove with: schtasks /Delete /TN "SparkyCart" /F
setlocal
set BASE_DIR=%~dp0..
schtasks /Create /TN "SparkyCart" /TR "\"%BASE_DIR%\deploy\start-prod.bat\"" /SC ONSTART /RL HIGHEST /F
if %errorlevel%==0 (
  echo Registered scheduled task "SparkyCart" to run at startup.
) else (
  echo Failed to register task. Run this from an elevated ^(Administrator^) prompt.
)
endlocal
