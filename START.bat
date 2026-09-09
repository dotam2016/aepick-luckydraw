@echo off
setlocal enabledelayedexpansion
title AEPICK Lucky Draw - Kiosk

REM ============================================================
REM  AEPICK POPUP LUCKY DRAW - launcher
REM  Double-click to build and start. Stop with Ctrl+C.
REM ============================================================

cd /d "%~dp0"

echo.
echo  ============================================================
echo    AEPICK  POPUP  LUCKY DRAW
echo  ============================================================
echo.

REM --- 1) Node.js check ---------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js is not installed.
  echo          Install the LTS version from https://nodejs.org
  echo.
  pause
  exit /b 1
)

REM  node:sqlite needs 22.13 or newer - 22.0 will fail at startup.
for /f "tokens=1,2 delims=." %%a in ('node -p "process.versions.node"') do (
  set NODEMAJ=%%a
  set NODEMIN=%%b
)
if !NODEMAJ! LSS 22 goto :oldnode
if !NODEMAJ! EQU 22 if !NODEMIN! LSS 13 goto :oldnode
echo  [1/3] Node.js OK
node --version
goto :install

:oldnode
echo  [ERROR] Node.js 22.13 or newer is required (this app uses node:sqlite).
node --version
echo          Install the LTS version from https://nodejs.org
echo.
pause
exit /b 1

REM --- 2) install packages (first run only) --------------------
:install
if not exist "node_modules\fastify" (
  echo.
  echo  [2/3] First run - installing packages. Needs internet, 3-5 min...
  call npm install
  if errorlevel 1 (
    echo.
    echo  [ERROR] Package install failed. Check your internet connection.
    pause
    exit /b 1
  )
) else (
  echo  [2/3] Packages OK
)

REM --- 3) build the kiosk screens ------------------------------
REM  The server only serves /kiosk/ when apps\kiosk\dist exists,
REM  so the build must succeed at least once.
if not exist "apps\kiosk\dist\index.html" (
  echo  [3/3] Building kiosk screens - about 30 seconds...
  call npm run build
  if errorlevel 1 (
    echo.
    echo  [ERROR] Build failed.
    echo          If this folder is inside Dropbox/OneDrive, pause syncing and retry.
    pause
    exit /b 1
  )
) else (
  echo  [3/3] Build OK  ^(delete apps\kiosk\dist to force a rebuild^)
)

echo.
echo  ============================================================
echo    KIOSK    http://localhost:8788/kiosk/
echo    ADMIN    http://localhost:8788/admin
echo.
echo    Operator PIN : 1234
echo    Keep this window open. Ctrl+C stops the server.
echo  ============================================================
echo.

start "" http://localhost:8788/kiosk/
call npm start

echo.
echo  Server stopped.
pause
