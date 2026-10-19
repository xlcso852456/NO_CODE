@echo off
cd /d "%~dp0"
set PORT=8010
set URL=http://127.0.0.1:%PORT%

rem If the server is already running, just open the browser
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
    echo NO_CODE server is already running: %URL%
    start "" %URL%
    timeout /t 3 >nul
    exit /b 0
)

echo Starting NO_CODE server: %URL%
echo Keep this window open. Press Ctrl+C to stop.
echo.
start "" /b powershell -NoProfile -Command "Start-Sleep 3; Start-Process '%URL%'"
python -m uvicorn main:app --reload --port %PORT%

echo.
echo Server stopped. If you see an error above, check it before closing.
pause
