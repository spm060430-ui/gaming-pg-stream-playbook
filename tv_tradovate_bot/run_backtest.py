#!/usr/bin/env python3
"""Backtest entrypoint (research mirror of the Pine strategy).

Examples
--------
  # Offline demo, no keys/network:
  python run_backtest.py --source synthetic --equity 3000

  # Real futures history via yfinance (NQ=F / GC=F proxies for MNQ / MGC):
  python run_backtest.py --source yfinance --equity 3000

  # CSVs you exported from TradingView/Tradovate into data/csv/<SYMBOL>.csv:
  python run_backtest.py --source csv --equity 3000

Writes equity_curve.csv, trades.csv (and a PNG if matplotlib is present) under
logs/backtest/, and prints a summary. READ THE SUMMARY before paper trading.
"""
from __future__ import annotations

import argparse
import os

import pandas as pd

from swingbot.backtest import run_backtest
from swingbot.config import load_config
from swingbot.data import load_bars
from swingbot.logging_setup import get_logger, setup_logging

log = get_logger(__name__)


def main() -> None:
    cfg = load_config()
    setup_logging(cfg.log_dir)

    ap = argparse.ArgumentParser(description="Backtest the micro-futures swing strategy.")
    ap.add_argument("--source", default="synthetic", choices=["synthetic", "yfinance", "csv"])
    ap.add_argument("--equity", type=float, default=3000.0)
    ap.add_argument("--days", type=int, default=cfg.history_days)
    ap.add_argument("--commission", type=float, default=0.35, help="$ per contract per side")
    ap.add_argument("--out-dir", default=os.path.join(cfg.log_dir, "backtest"))
    args = ap.parse_args()

    log.info("Backtest source=%s watchlist=%s", args.source, cfg.watchlist)
    bars = load_bars(cfg.watchlist, source=args.source, lookback_days=args.days)

    result = run_backtest(
        bars, cfg.strategy, cfg.risk,
        starting_equity=args.equity, commission_per_contract=args.commission,
    )

    print()
    print(result.summary())
    print()

    os.makedirs(args.out_dir, exist_ok=True)
    result.equity_curve.to_csv(os.path.join(args.out_dir, "equity_curve.csv"), header=["equity"])
    pd.DataFrame([t.__dict__ for t in result.trades]).to_csv(
        os.path.join(args.out_dir, "trades.csv"), index=False
    )
    log.info("Wrote equity_curve.csv and trades.csv to %s", args.out_dir)

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt  # noqa: F401

        ax = result.equity_curve.plot(title="Backtest equity curve", figsize=(10, 5))
        ax.set_ylabel("Equity ($)")
        ax.figure.tight_layout()
        ax.figure.savefig(os.path.join(args.out_dir, "equity_curve.png"), dpi=120)
        log.info("Saved equity_curve.png")
    except Exception as e:  # noqa: BLE001
        log.info("Plot skipped (%s)", e)


if __name__ == "__main__":
    main()
