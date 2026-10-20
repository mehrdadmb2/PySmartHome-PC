@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" goto :venv
py -3 -c "import flask, requests" >nul 2>&1
if errorlevel 1 goto :missing
py -3 server.py
if errorlevel 1 echo Server stopped with an error.
pause
exit /b 0
:venv
".venv\Scripts\python.exe" -c "import flask, requests" >nul 2>&1
if errorlevel 1 goto :missing
".venv\Scripts\python.exe" server.py
if errorlevel 1 echo Server stopped with an error.
pause
exit /b 0
:missing
echo Dependencies are missing. Run setup_windows.bat first.
pause
exit /b 1
