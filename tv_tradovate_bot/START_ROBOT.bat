@echo off
REM ===================================================================
REM  Double-click this file to start the robot's server (safe dry-run).
REM  No black-window typing needed. Leave the window that opens OPEN.
REM ===================================================================
cd /d "%~dp0"

REM Create the settings file the first time, if it's missing.
if not exist .env copy .env.example .env >nul

REM Use a realistic pretend account so the robot actually "acts" in tests.
set DRY_RUN_EQUITY=80000

echo.
echo ===================================================================
echo   Starting your trading robot in SAFE PRETEND MODE (dry-run).
echo   Nothing real is bought or sold.
echo.
echo   When you see a line like:
echo       Uvicorn running on http://0.0.0.0:8000
echo   ...the robot is awake. LEAVE THIS WINDOW OPEN.
echo.
echo   Check it in your browser:  http://localhost:8000/health
echo   To stop the robot: close this window (or press Ctrl+C).
echo ===================================================================
echo.

python run_relay.py

echo.
echo The robot's server has stopped.
pause
