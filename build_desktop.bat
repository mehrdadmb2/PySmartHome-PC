@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run setup_windows.bat first.
  pause
  exit /b 1
)
echo Installing desktop-packaging requirements...
".venv\Scripts\python.exe" -m pip install -r requirements-desktop.txt
if errorlevel 1 goto :error
echo Building the Windows desktop application (one-folder distribution)...
".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --onedir --windowed --name PySmartHome-PC --collect-all webview --add-data "index.html;." --add-data "style.css;." --add-data "app.js;." --add-data "bg.js;." --add-data "sw.js;." --add-data "manifest.webmanifest;." --add-data "icon.svg;." --add-data "analytics-loader.js;." desktop_app.py
if errorlevel 1 goto :error
if not exist "dist\PySmartHome-PC\data" mkdir "dist\PySmartHome-PC\data"
xcopy "data\*" "dist\PySmartHome-PC\data\" /E /I /Y >nul
if not exist "dist\PySmartHome-PC\Board-Code" mkdir "dist\PySmartHome-PC\Board-Code"
xcopy "Board-Code\*.ino" "dist\PySmartHome-PC\Board-Code\" /Y >nul
echo.
echo Build complete: dist\PySmartHome-PC\PySmartHome-PC.exe
echo Keep the entire dist\PySmartHome-PC folder together. Put config.txt or .env beside the exe if you need GitHub publishing.
pause
exit /b 0
:error
echo Desktop build failed. Check the error above.
pause
exit /b 1
