"""Synthetic futures price generator.

Deterministic geometric random walk with a slow trend so EMA crossovers occur.
Lets the backtest and tests run with no API keys and no network -- useful for CI
and for verifying backtest/Pine parity. Prices are scaled to look like MNQ/MGC.
"""
from __future__ import annotations

from datetime import datetime
from typing import Dict, List

import numpy as np
import pandas as pd

# Rough starting levels so synthetic series resemble the real instruments.
_START_LEVEL = {"MNQ": 18000.0, "MGC": 2300.0}


def make_series(symbol: str, days: int = 500, seed: int = 0,
                drift: float = 0.0002, vol: float = 0.012) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(end=datetime(2025, 1, 1), periods=days)
    t = np.arange(days)
    trend = drift + 0.002 * np.sin(t / 30.0)
    log_ret = trend + rng.normal(0, vol, size=days)
    start = _START_LEVEL.get(symbol.upper(), 100.0)
    close = start * np.exp(np.cumsum(log_ret))
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.005, days))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.005, days))
    volume = rng.integers(50_000, 300_000, days)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=idx,
    )


def make_watchlist(symbols: List[str], days: int = 500) -> Dict[str, pd.DataFrame]:
    return {s: make_series(s, days=days, seed=100 + i) for i, s in enumerate(symbols)}
