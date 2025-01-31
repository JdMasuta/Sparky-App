@echo off
:: start.bat - Portable Application Launcher

:: Enable command echoing for debugging
:: echo on

:: Set base directory
set BASE_DIR=%~dp0
echo Base directory is: %BASE_DIR%

:: First, run the setup script to ensure environment variables are set
echo Running setup.bat...
echo.
if exist "%BASE_DIR%setup.bat" (
    call "%BASE_DIR%setup.bat"
) else (
    echo ERROR: setup.bat not found at: %BASE_DIR%setup.bat
    pause
    exit /b 1
)

:: Create a new directory for logs if it doesn't exist
if not exist "%BASE_DIR%logs" mkdir "%BASE_DIR%logs"

:: Check if backend directory exists
::echo Checking backend directory...
if not exist "%BASE_DIR%backend\" (
    echo ERROR: Backend directory does not exist at: %BASE_DIR%backend
    pause
    exit /b 1
)

:: Check if frontend directory exists
::echo Checking frontend directory...
if not exist "%BASE_DIR%frontend\" (
    echo ERROR: Frontend directory does not exist at: %BASE_DIR%frontend
    pause
    exit /b 1
)

:: Check if node executable exists
::echo Checking Node.js executable...
if not exist "%BASE_DIR%runtime\node-portable\node.exe" (
    echo ERROR: Node.js executable not found at: %BASE_DIR%runtime\node-portable\node.exe
    pause
    exit /b 1
)

:: Start Backend Server
echo Starting backend server...
cd backend\src
::echo Current directory is now: %CD%
start "Sparky Backend Server" cmd /k "%BASE_DIR%runtime\node-portable\node.exe %BASE_DIR%runtime\node-portable\node_modules\npm\bin\npm-cli.js run dev"
cd %BASE_DIR%

:: Wait a moment for backend to initialize
timeout /t 2

:: Start Frontend Development Server
echo Starting frontend development server...
cd frontend
::echo Current directory is now: %CD%
start "Sparky Frontend Server" cmd /k "%BASE_DIR%runtime\node-portable\node.exe %BASE_DIR%runtime\node-portable\node_modules\npm\bin\npm-cli.js run dev"
cd %BASE_DIR%

echo Application servers started!
echo Backend running at http://localhost:3000
echo Frontend running at http://localhost:5173

:: Keep the command prompt window open