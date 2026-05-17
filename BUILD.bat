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

:: Check firebase-applet-config.json
if not exist firebase-applet-config.json (
  echo  [ERROR] firebase-applet-config.json not found!
  echo.
  echo  Copy firebase-applet-config.example.json to firebase-applet-config.json
  echo  and fill in your Firebase project credentials.
  echo.
  pause & exit /b 1
)
echo  [OK] Firebase config found
echo.

:: Step 1 - Install dependencies
echo  [1/4] Installing dependencies...
call npm install --legacy-peer-deps
if %ERRORLEVEL% NEQ 0 (
  echo  [ERROR] npm install failed.
  pause & exit /b 1
)
echo  [OK] Dependencies ready
echo.

:: Step 2 - Generate icons
echo  [2/4] Generating app icons...
call npm run icons 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo  [WARN] Icon generation failed - using existing icons
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

:: Step 4 - Package with electron-builder (local only, no publish)
echo  [4/4] Packaging Windows installer...
call npx electron-builder --win --publish never
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
echo    Al-Fateh Clinic Setup *.exe    ^(Installer - recommended^)
echo    Al-Fateh Clinic *.exe          ^(Portable EXE - no install^)
echo    latest.yml                     ^(Auto-update metadata^)
echo.
echo  To publish a release to GitHub so users get auto-updates:
echo    1. Bump version: npm run bump:patch
echo    2. Commit + tag: git tag vX.Y.Z ^&^& git push --tags
echo    3. GitHub Actions builds and publishes automatically.
echo.
echo  See RELEASE_GUIDE.md for full instructions.
echo.
pause
