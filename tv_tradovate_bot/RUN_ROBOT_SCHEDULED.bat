@echo off
REM ===================================================================
REM  This is the file Windows runs automatically every evening.
REM  You normally do NOT double-click this yourself -- SETUP_DAILY_SCHEDULE.bat
REM  tells Windows to run it for you. It checks the market and pops up a
REM  plain-English message telling you what to do. Still safe dry-run.
REM ===================================================================
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
set DRY_RUN_EQUITY=80000
python run_daily_bot.py --source yfinance --popup
