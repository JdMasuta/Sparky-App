@echo off
:: update.bat - Check for and apply a Sparky Cart update from GitHub Releases.
:: Runs the Node updater with the bundled portable runtime (no PowerShell).
::
:: Schedule periodic checks:
::   schtasks /Create /TN "SparkyUpdate" /TR "\"<install>\deploy\update.bat\"" /SC DAILY /ST 03:00
:: Or check without applying:  deploy\update.bat --check
setlocal
set BASE_DIR=%~dp0..
set NODE_EXE=%BASE_DIR%\runtime\node-portable\node.exe
if not exist "%NODE_EXE%" (
  echo ERROR: portable node not found at %NODE_EXE%
  exit /b 1
)
"%NODE_EXE%" "%BASE_DIR%\deploy\updater.mjs" %*
endlocal
