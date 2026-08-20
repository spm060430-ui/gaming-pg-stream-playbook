@echo off
REM ===================================================================
REM  Double-click ONCE to make the robot check the market by itself
REM  every weekday evening and pop up what to do. Set-and-forget.
REM ===================================================================
cd /d "%~dp0"

echo.
echo Setting the robot to check the market automatically
echo every weekday, Monday to Friday, at 6:00 PM...
echo.

schtasks /Create /SC WEEKLY /D MON,TUE,WED,THU,FRI /TN "SwingRobotDaily" /TR "\"%~dp0RUN_ROBOT_SCHEDULED.bat\"" /ST 18:00 /F

if %errorlevel%==0 goto ok
goto fail

:ok
echo.
echo ============================================================
echo  SUCCESS! The robot is now on autopilot for checking.
echo  Every weekday at 6:00 PM it looks at the market and pops
echo  up a message: "BUY gold" or "nothing to do".
echo  When it says BUY, open TradingView and tap Buy.
echo.
echo  Your PC must be ON and you logged in at 6 PM for the popup.
echo  If it's off, just double-click RUN_ROBOT_DAILY when you're back.
echo ============================================================
goto end

:fail
echo.
echo That did not work -- Windows blocked it. Easy fix:
echo   Close this window, then RIGHT-CLICK this same file and
echo   choose "Run as administrator".
goto end

:end
echo.
pause
