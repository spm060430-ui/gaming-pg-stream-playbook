#!/usr/bin/env python3
"""Generate and save (and optionally email) the daily summary report.

  python run_report.py

Schedule this once per day after the futures daily settlement (e.g. via cron).
In dry-run without credentials it still reports the bot's tracked state; with
Tradovate credentials it also pulls live equity and positions.
"""
from __future__ import annotations

from swingbot.config import load_config
from swingbot.logging_setup import get_logger, setup_logging
from swingbot.report import build_daily_report

log = get_logger(__name__)


def main() -> None:
    cfg = load_config()
    setup_logging(cfg.log_dir)

    broker = None
    if cfg.tradovate.username and cfg.tradovate.password:
        try:
            from swingbot.tradovate import TradovateClient

            broker = TradovateClient(cfg.tradovate)
        except Exception as e:  # noqa: BLE001
            log.warning("Could not init Tradovate client for report: %s", e)

    text = build_daily_report(cfg, broker)
    print(text)


if __name__ == "__main__":
    main()
