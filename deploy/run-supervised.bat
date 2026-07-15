@echo off
:: run-supervised.bat <workdir> <node.exe> <script>
:: Runs a Node script and restarts it if it exits (crash supervision).
:: A short backoff avoids a tight crash loop.
setlocal
set WORKDIR=%~1
set NODE_EXE=%~2
set SCRIPT=%~3

cd /d "%WORKDIR%"
:loop
echo [%date% %time%] starting %SCRIPT% in %WORKDIR%
"%NODE_EXE%" %SCRIPT%
echo [%date% %time%] %SCRIPT% exited with code %errorlevel%. Restarting in 3s...
timeout /t 3 /nobreak > nul
goto loop
