@echo off
cd /d "%~dp0"
rem Drag a video file onto this .bat to loop that video instead of the test pattern
python start_test_rtsp.py %*
echo.
pause
