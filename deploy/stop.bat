@echo off
:: stop.bat - Stop the supervised Sparky services.
:: Closes the supervisor windows and any node processes they launched.
echo Stopping Sparky services...
taskkill /FI "WINDOWTITLE eq Sparky Backend*" /T /F > nul 2>&1
taskkill /FI "WINDOWTITLE eq Sparky PLC Bridge*" /T /F > nul 2>&1
echo Done.
