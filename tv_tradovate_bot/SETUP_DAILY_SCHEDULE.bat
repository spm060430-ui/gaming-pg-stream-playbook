@echo off
REM ===================================================================
REM  Double-click ONCE to make the robot check the market by itself
REM  every weekday evening and pop up what to do. Set-and-forget.
REM ===================================================================
cd /d "%~dp0"

echo.
echo Setting the robot to check the market automatically
echo every weekday (Mon-Fri) at 6:00 PM...
echo.

schtasks /Create /SC WEEKLY /D MON,TUE,WED,THU,FRI /TN "SwingRobotDaily" /TR "\"%~dp0RUN_ROBOT_SCHEDULED.bat\"" /ST 18:00 /F

if %errorlevel%==0 (
  echo.
  echo ============================================================
  echo  SUCCESS! The robot is now on autopilot for checking.
  echo  Every weekday at 6:00 PM it will look at the market and
  echo  pop up a message: "BUY gold" or "nothing to do".
  echo  When it says BUY, open TradingView and tap Buy.
  echo.
  echo  Your PC must be ON and you logged in at 6 PM for the popup.
  echo  If it's off, just double-click RUN_ROBOT_DAILY when you're back.
  echo  To change the time or turn this off, see the notes from Claude.
  echo ============================================================
) else (
  echo.
  echo That didn't work -- Windows blocked it. Easy fix:
  echo   1) Close this window.
  echo   2) RIGHT-CLICK this file ^(SETUP_DAILY_SCHEDULE^) and choose
  echo      "Run as administrator".
)
echo.
pause
