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
import sys
from datetime import datetime, timezone
from typing import List, Tuple

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


def show_popup(title: str, message: str) -> None:
    """Pop up a message box on Windows; elsewhere just print it.

    Uses ctypes (built into Python) so there is nothing to install. When run by
    Windows Task Scheduler with 'run only when user is logged on', this appears
    on the desktop.
    """
    print("\n" + "=" * 50 + f"\n{title}\n{message}\n" + "=" * 50)
    if sys.platform.startswith("win"):
        try:
            import ctypes

            # 0x40 = information icon, 0x1000 = show on top.
            ctypes.windll.user32.MessageBoxW(0, message, title, 0x40 | 0x1000)
        except Exception as e:  # noqa: BLE001
            log.warning("Could not show popup: %s", e)


def build_popup_text(today, raw_signals: List[Tuple[str, str]]) -> str:
    """Turn the day's raw signals into a plain-English 'what to do' message."""
    buys = [sym for sym, action in raw_signals if action == LONG_ENTRY]
    sells = [sym for sym, action in raw_signals if action in (LONG_EXIT, SHORT_ENTRY)]
    lines = [f"Robot check for {today}:", ""]
    if buys:
        lines.append("BUY signal:  " + ", ".join(buys))
        lines.append("   -> open TradingView and tap BUY.")
    if sells:
        lines.append("SELL / CLOSE signal:  " + ", ".join(sells))
        lines.append("   -> open TradingView and tap CLOSE.")
    if not buys and not sells:
        lines.append("No signal today. Nothing to do. :)")
    return "\n".join(lines)


def main() -> None:
    cfg = load_config()
    setup_logging(cfg.log_dir)

    ap = argparse.ArgumentParser(description="Run the automatic swing robot once.")
    ap.add_argument("--source", default="yfinance",
                    choices=["yfinance", "synthetic", "csv"],
                    help="Where to get the daily bars for signals (default yfinance).")
    ap.add_argument("--popup", action="store_true",
                    help="Pop up a plain-English 'what to do' message when done "
                         "(used by the daily scheduled run).")
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
    raw_signals: List[Tuple[str, str]] = []
    for sym in cfg.watchlist:
        df = bars.get(sym)
        if df is None or df.empty:
            log.warning("%s: no data this run, skipping", sym)
            continue
        sig = strategy.latest_signal(sym, df, cfg.strategy)
        if sig is None:
            log.info("%s: not enough history yet, skipping", sym)
            continue
        raw_signals.append((sym, sig.action))
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

    # 5) plain-English 'what to do' popup (for the scheduled daily run)
    popup_text = build_popup_text(today, raw_signals)
    if args.popup:
        show_popup("Swing Robot - daily check", popup_text)
    else:
        log.info("Summary: %s", popup_text.replace("\n", " | "))


if __name__ == "__main__":
    main()
