@echo off
REM Double-click to turn OFF the automatic daily check.
schtasks /Delete /TN "SwingRobotDaily" /F
echo.
echo The automatic daily check has been turned off.
echo (You can still run it by hand anytime with RUN_ROBOT_DAILY.)
echo.
pause
