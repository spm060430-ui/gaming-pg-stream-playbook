"""Research data loader for the backtester.

Live trading gets its data from TradingView (the Pine strategy). For *offline
research* we need historical daily bars. Sources:

  * "synthetic" -- deterministic, no network (default; good for CI/tests).
  * "yfinance"  -- continuous front-month futures proxies:
        MNQ -> NQ=F (E-mini Nasdaq), MGC -> GC=F (Gold).
     These track the same underlying so the strategy's *behaviour* is
     representative; exact micro prices/costs differ (handled by contract specs).
  * "csv"       -- load OHLC CSVs you exported from TradingView/Tradovate.

Everything returns symbol -> DataFrame with lowercase open/high/low/close/volume,
sorted ascending by date.
"""
from __future__ import annotations

import os
from typing import Dict, List

import pandas as pd

from .logging_setup import get_logger
from .synthetic import make_watchlist

log = get_logger(__name__)

# Map our micro roots to liquid continuous-futures Yahoo tickers.
YF_PROXY = {"MNQ": "NQ=F", "MGC": "GC=F", "MES": "ES=F", "M2K": "RTY=F", "MCL": "CL=F"}


class DataError(RuntimeError):
    pass


def load_yfinance(symbols: List[str], lookback_days: int = 400) -> Dict[str, pd.DataFrame]:
    try:
        import yfinance as yf
    except ImportError as e:  # pragma: no cover
        raise DataError("yfinance not installed. `pip install yfinance`.") from e

    out: Dict[str, pd.DataFrame] = {}
    period_days = int(lookback_days * 1.6) + 10
    for sym in symbols:
        proxy = YF_PROXY.get(sym.upper(), sym)
        try:
            df = yf.download(proxy, period=f"{period_days}d", interval="1d",
                             auto_adjust=False, progress=False)
            if df is None or df.empty:
                log.warning("yfinance: no data for %s (%s)", sym, proxy)
                continue
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df = df.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]]
            out[sym] = df.dropna().sort_index()
        except Exception as e:  # noqa: BLE001
            log.warning("yfinance error for %s: %s", sym, e)
    if not out:
        raise DataError("yfinance returned no data for the watchlist.")
    return out


def load_csv(symbols: List[str], csv_dir: str) -> Dict[str, pd.DataFrame]:
    """Load <csv_dir>/<SYMBOL>.csv files with a date index and OHLC columns."""
    out: Dict[str, pd.DataFrame] = {}
    for sym in symbols:
        path = os.path.join(csv_dir, f"{sym}.csv")
        if not os.path.exists(path):
            log.warning("CSV missing for %s: %s", sym, path)
            continue
        df = pd.read_csv(path)
        # Best-effort column normalisation.
        df.columns = [c.strip().lower() for c in df.columns]
        date_col = next((c for c in ("date", "time", "timestamp") if c in df.columns), None)
        if date_col:
            df[date_col] = pd.to_datetime(df[date_col])
            df = df.set_index(date_col)
        df = df.rename(columns=str.lower).sort_index()
        keep = [c for c in ("open", "high", "low", "close", "volume") if c in df.columns]
        out[sym] = df[keep].dropna()
    if not out:
        raise DataError(f"No CSVs found in {csv_dir} for {symbols}.")
    return out


def load_bars(symbols: List[str], source: str = "synthetic",
              lookback_days: int = 400, csv_dir: str = "data/csv") -> Dict[str, pd.DataFrame]:
    if source == "synthetic":
        return make_watchlist(symbols, days=max(lookback_days, 500))
    if source == "yfinance":
        return load_yfinance(symbols, lookback_days)
    if source == "csv":
        return load_csv(symbols, csv_dir)
    raise DataError(f"Unknown data source '{source}'.")
