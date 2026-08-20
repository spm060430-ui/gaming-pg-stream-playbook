@echo off
REM ===================================================================
REM  Double-click this AFTER the robot is running (START_ROBOT.bat).
REM  It pokes the robot with a fake "buy gold" signal so you can watch
REM  it react. Still 100%% pretend -- nothing real happens.
REM
REM  NOTE: the secret below must match WEBHOOK_SECRET in your .env file.
REM  It matches the default. If you change the secret later (before
REM  connecting TradingView), update it here too.
REM ===================================================================
cd /d "%~dp0"

echo Sending a fake "buy gold" signal to the robot...
echo.
python -c "import requests;print(requests.post('http://localhost:8000/webhook',json={'secret':'change-me-to-a-long-random-string','id':'test1','action':'long_entry','symbol':'MGC','price':2300,'atr':25,'rsi':55}).json())"
echo.
echo If you saw {'accepted': True, 'action_taken': 'entered', ...} it WORKED.
echo (Look at the robot's window too -- a new ALERT line appears there.)
echo.
pause
