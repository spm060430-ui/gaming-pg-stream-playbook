#!/usr/bin/env python3
"""The fully-automatic 'robot runner' (no TradingView needed).

This is the Python-only path: the robot checks the market itself, decides using
the SAME brain (EMA cross + RSI) and the SAME safety layer (sizing, ATR stop,
circuit breakers, min-hold) as the rest of the system, and sends orders straight
to Tradovate. Run it once per day, after the futures close.

How it works each run:
  1. Pull recent daily bars for each symbol (MNQ, MGC).
  2. Compute today's signal for each (enter / exit / hold).
  3. Feed each real signal through the existing decision engine, which applies
     all the risk checks and (unless dry-run) places the Tradovate order.
  4. Save a daily report.

Safety:
  * Defaults to DRY-RUN (RELAY_DRY_RUN=true): it logs what it WOULD do and places
    nothing. Prove it out here first.
  * Then set RELAY_DRY_RUN=false, TRADOVATE_ENV=demo and your Tradovate API creds
    to trade the DEMO (fake-money) account. Only much later, live.

Data:
  * --source yfinance uses the index/gold underlying (NQ=F/GC=F) for the daily
    signal -- micros track these tick-for-tick, so the crossover is the same.
  * --source synthetic runs offline with fake data (for testing the plumbing).

Scheduling (Windows): use Task Scheduler to run RUN_ROBOT_DAILY.bat once each
weekday evening. If the PC is off at run time, that day is simply skipped
(fine for a slow swing strategy, but note it).
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

from swingbot import strategy
from swingbot.config import load_config
from swingbot.data import load_bars
from swingbot.engine import process_alert
from swingbot.logging_setup import get_logger, setup_logging
from swingbot.notify import alert as send_alert
from swingbot.report import build_daily_report
from swingbot.strategy import LONG_ENTRY, LONG_EXIT, SHORT_ENTRY, SHORT_EXIT

log = get_logger(__name__)

# Map the strategy's signal constants to the engine's alert actions.
ACTION_MAP = {
    LONG_ENTRY: "long_entry",
    LONG_EXIT: "long_exit",
    SHORT_ENTRY: "short_entry",
    SHORT_EXIT: "short_exit",
}


def main() -> None:
    cfg = load_config()
    setup_logging(cfg.log_dir)

    ap = argparse.ArgumentParser(description="Run the automatic swing robot once.")
    ap.add_argument("--source", default="yfinance",
                    choices=["yfinance", "synthetic", "csv"],
                    help="Where to get the daily bars for signals (default yfinance).")
    args = ap.parse_args()

    today = datetime.now(timezone.utc).date()
    log.info("=== Daily robot run %s | source=%s dry_run=%s env=%s ===",
             today, args.source, cfg.relay.dry_run, cfg.tradovate.env)

    # A shared secret is required by the engine even for internally-generated
    # signals; use the configured one (kept consistent with the .env).
    if not cfg.relay.webhook_secret:
        log.error("WEBHOOK_SECRET is not set in .env -- refusing to run. "
                  "Add it and retry.")
        raise SystemExit(1)

    # Build the broker unless we're in dry-run (then no creds needed).
    broker = None
    if not cfg.relay.dry_run:
        try:
            from swingbot.tradovate import TradovateClient

            broker = TradovateClient(cfg.tradovate)
        except Exception as e:  # noqa: BLE001
            send_alert(cfg.notify, "Robot HALTED: cannot reach Tradovate", str(e),
                       level="error")
            raise SystemExit(f"Tradovate init failed: {e}")

    # 1) market data
    try:
        bars = load_bars(cfg.watchlist, source=args.source, lookback_days=cfg.history_days)
    except Exception as e:  # noqa: BLE001
        send_alert(cfg.notify, "Robot HALTED: no market data", str(e), level="error")
        raise SystemExit(f"Data fetch failed: {e}")

    # 2 + 3) signals -> engine (which does risk + optional order)
    for sym in cfg.watchlist:
        df = bars.get(sym)
        if df is None or df.empty:
            log.warning("%s: no data this run, skipping", sym)
            continue
        sig = strategy.latest_signal(sym, df, cfg.strategy)
        if sig is None:
            log.info("%s: not enough history yet, skipping", sym)
            continue
        action = ACTION_MAP.get(sig.action)
        if action is None:
            log.info("%s: HOLD (%s)", sym, sig.reason)
            continue

        payload = {
            "secret": cfg.relay.webhook_secret,
            # One id per symbol+action+day => the same signal is acted on once,
            # even if the robot runs twice in a day.
            "id": f"{sym}-{action}-{today.isoformat()}",
            "action": action,
            "symbol": sym,
            "price": sig.price,
            "atr": sig.atr,
            "rsi": sig.rsi,
        }
        try:
            result = process_alert(payload, cfg, broker, today=today)
            log.info("%s: %s -> %s (%s)", sym, action, result.action_taken, result.detail)
        except Exception as e:  # noqa: BLE001 -- engine halts+alerts internally
            log.error("%s: engine error on %s: %s", sym, action, e)

    # 4) daily report
    report = build_daily_report(cfg, broker)
    print()
    print(report)


if __name__ == "__main__":
    main()
