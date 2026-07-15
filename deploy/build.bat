@echo off
:: build.bat - Prepare a production build on the edge device (or a build host).
:: Installs production deps and builds the frontend into backend\src\public.
:: Uses only the bundled portable Node runtime.
setlocal
set BASE_DIR=%~dp0..
set NODE_EXE=%BASE_DIR%\runtime\node-portable\node.exe
set NPM_CLI=%BASE_DIR%\runtime\node-portable\node_modules\npm\bin\npm-cli.js

echo Installing backend dependencies...
cd /d "%BASE_DIR%\backend" && "%NODE_EXE%" "%NPM_CLI%" ci --omit=dev || goto fail

echo Installing microservice dependencies...
cd /d "%BASE_DIR%\microservice" && "%NODE_EXE%" "%NPM_CLI%" ci --omit=dev || goto fail

echo Building frontend...
cd /d "%BASE_DIR%\frontend" && "%NODE_EXE%" "%NPM_CLI%" ci || goto fail
cd /d "%BASE_DIR%\frontend" && "%NODE_EXE%" "%NPM_CLI%" run build || goto fail

echo.
echo Build complete. Start with deploy\start-prod.bat
endlocal
exit /b 0

:fail
echo BUILD FAILED.
endlocal
exit /b 1
