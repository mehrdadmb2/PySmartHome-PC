@echo off
setlocal
cd /d "%~dp0"
echo [1/3] Checking Python...
py -3 --version >nul 2>&1
if errorlevel 1 (
  echo Python 3 was not found. Install Python 3.11+ from https://www.python.org/downloads/windows/
  echo Make sure "Add python.exe to PATH" is checked.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo [2/3] Creating the project virtual environment...
  py -3 -m venv .venv
  if errorlevel 1 goto :error
)
echo [3/3] Installing application dependencies...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :error
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :error
echo.
echo Setup complete. Run start_server.bat for the local dashboard.
pause
exit /b 0
:error
echo Setup failed. Read the error above and try again.
pause
exit /b 1
