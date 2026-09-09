@echo off
setlocal
title AEPICK Lucky Draw - Share Online (Cloudflare Tunnel)

REM ============================================================
REM  Publishes this kiosk to a temporary public URL.
REM  The URL disappears when this window closes.
REM
REM  Every run generates a NEW operator PIN and admin key,
REM  because the defaults (1234 / aepick-admin) are written in
REM  the README and must never be exposed to the internet.
REM ============================================================

cd /d "%~dp0"

echo.
echo  ============================================================
echo    AEPICK Lucky Draw  -  Share Online
echo  ============================================================
echo.
echo    This makes the kiosk reachable from the internet.
echo    Anyone with the link can open it. Close this window to stop.
echo.

REM --- cloudflared check --------------------------------------
if not exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" (
  if not exist "C:\Program Files\cloudflared\cloudflared.exe" (
    where cloudflared >nul 2>nul
    if errorlevel 1 (
      echo  [ERROR] cloudflared is not installed.
      echo          Run:  winget install Cloudflare.cloudflared
      echo.
      pause
      exit /b 1
    )
  )
)

REM --- build must exist ---------------------------------------
if not exist "apps\kiosk\dist\index.html" (
  echo  Building kiosk screens first...
  call npm run build
  if errorlevel 1 (
    echo  [ERROR] Build failed.
    pause
    exit /b 1
  )
)

call npm run tunnel

echo.
echo  Tunnel closed. The public URL no longer works.
pause
