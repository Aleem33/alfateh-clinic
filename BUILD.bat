@echo off
title Al-Fateh Clinic - Builder
color 0A
echo.
echo  ================================================
echo    Al-Fateh Clinic - Windows Builder
echo  ================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo  [ERROR] Node.js not found.
  echo  Download from https://nodejs.org
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER%
echo.

:: Step 1 - Install dependencies
echo  [1/3] Installing dependencies...
call npm install --legacy-peer-deps
if %ERRORLEVEL% NEQ 0 (
  echo  [ERROR] npm install failed.
  pause & exit /b 1
)
echo  [OK] Dependencies ready
echo.

:: Step 2 - App icons from logo
echo  [2/4] Generating app icons...
call npm run icons
if %ERRORLEVEL% NEQ 0 (
  echo  [ERROR] Icon generation failed.
  pause & exit /b 1
)
echo  [OK] Icons ready
echo.

:: Step 3 - Build Vite/React app
echo  [3/4] Building React app...
call npm run build
if %ERRORLEVEL% NEQ 0 (
  echo  [ERROR] Build failed. Check errors above.
  pause & exit /b 1
)
echo  [OK] React build complete
echo.

:: Step 4 - Package Electron app
echo  [4/4] Packaging Windows installer...
call npx electron-builder --win
if %ERRORLEVEL% NEQ 0 (
  echo  [ERROR] Electron packaging failed.
  pause & exit /b 1
)

echo.
echo  ================================================
echo    BUILD COMPLETE!
echo  ================================================
echo.
echo  Your files are in:  release\
echo.
echo    Al-Fateh Clinic Setup.exe    (Installer)
echo    Al-Fateh Clinic.exe          (Portable EXE)
echo.
echo  Install on any Windows PC.
echo  Data is stored in Firebase Cloud.
echo.
pause
