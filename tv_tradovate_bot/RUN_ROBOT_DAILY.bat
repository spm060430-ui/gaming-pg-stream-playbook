@echo off
REM ===================================================================
REM  Double-click to run the automatic robot ONCE on today's market.
REM  It checks the market, decides, and (only when you've turned dry-run
REM  OFF and added Tradovate demo keys) places the trade on Tradovate.
REM
REM  SAFE BY DEFAULT: while .env has RELAY_DRY_RUN=true it places NOTHING,
REM  it just shows what it WOULD do. Prove it out this way first.
REM ===================================================================
cd /d "%~dp0"

if not exist .env copy .env.example .env >nul

REM Pretend account size used ONLY in dry-run tests. When you go to real
REM Tradovate demo, your actual account balance is used instead.
set DRY_RUN_EQUITY=80000

echo.
echo Running the robot once on today's REAL Nasdaq/Gold data...
echo (If you see a network error, tell Claude and we'll switch to test data.)
echo.

python run_daily_bot.py --source yfinance

echo.
echo Done. Scroll up to read the robot's decisions and the daily report.
pause
