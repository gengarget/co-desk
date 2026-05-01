@echo off
setlocal

cd /d "%~dp0"
title Co-Desk Launcher

echo.
echo ========================================
echo   Co-Desk desktop client launcher
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Please install Node.js first.
  echo https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Please install Node.js first.
  echo https://nodejs.org/
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python was not found. Please install Python first.
  echo https://www.python.org/downloads/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/3] Installing desktop dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Desktop dependencies found.
)

python -c "import fastapi, uvicorn" >nul 2>nul
if errorlevel 1 (
  echo [2/3] Installing backend dependencies...
  python -m pip install -r server\requirements.txt
  if errorlevel 1 (
    echo [ERROR] Backend dependency installation failed.
    pause
    exit /b 1
  )
) else (
  echo [2/3] Backend dependencies found.
)

echo [3/3] Starting Co-Desk...
echo.
echo Keep this window open while using Co-Desk.
echo To stop Co-Desk, close this window or press Ctrl+C.
echo.

call npm run dev

pause
