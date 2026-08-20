"""Signal generation: EMA crossover + RSI filter (research mirror of the Pine).

This mirrors `pine/swing_strategy.pine` so the Python backtester and the live
Pine strategy make the same decisions:

  * golden cross (fast EMA over slow) + RSI <= overbought  -> long entry
  * death cross (fast EMA under slow)                       -> long exit
  * (optional) death cross + RSI >= oversold               -> short entry
  * (optional) golden cross                                 -> short exit

`generate_signals` annotates a full OHLC DataFrame; the backtest walks it and
the relay's own guard can re-check the last row.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import pandas as pd

from .config import StrategyParams
from .indicators import atr, ema, rsi

LONG_ENTRY = "LONG_ENTRY"
LONG_EXIT = "LONG_EXIT"
SHORT_ENTRY = "SHORT_ENTRY"
SHORT_EXIT = "SHORT_EXIT"
HOLD = "HOLD"


@dataclass
class Signal:
    symbol: str
    action: str
    price: float
    ema_fast: float
    ema_slow: float
    rsi: float
    atr: float
    reason: str


def generate_signals(df: pd.DataFrame, params: StrategyParams) -> pd.DataFrame:
    out = df.copy()
    out["ema_fast"] = ema(out["close"], params.ema_fast)
    out["ema_slow"] = ema(out["close"], params.ema_slow)
    out["rsi"] = rsi(out["close"], params.rsi_period)
    if {"high", "low"}.issubset(out.columns):
        out["atr"] = atr(out, params.atr_period)
    else:
        out["atr"] = float("nan")

    fast_above = out["ema_fast"] > out["ema_slow"]
    prev = fast_above.shift(1)
    out["golden_cross"] = fast_above & (~prev.fillna(fast_above))
    out["death_cross"] = (~fast_above) & (prev.fillna(~fast_above))
    first_valid = out["ema_slow"].notna() & out["ema_slow"].shift(1).notna()
    out.loc[~first_valid, ["golden_cross", "death_cross"]] = False

    out["long_entry"] = out["golden_cross"] & (out["rsi"] <= params.rsi_overbought)
    out["long_exit"] = out["death_cross"]
    if params.allow_shorts:
        out["short_entry"] = out["death_cross"] & (out["rsi"] >= params.rsi_oversold)
        out["short_exit"] = out["golden_cross"]
    else:
        out["short_entry"] = False
        out["short_exit"] = False
    return out


def latest_signal(symbol: str, df: pd.DataFrame, params: StrategyParams) -> Optional[Signal]:
    a = generate_signals(df, params)
    if a.empty:
        return None
    row = a.iloc[-1]
    if pd.isna(row["ema_slow"]) or pd.isna(row["rsi"]):
        return None
    common = dict(
        symbol=symbol,
        price=float(row["close"]),
        ema_fast=float(row["ema_fast"]),
        ema_slow=float(row["ema_slow"]),
        rsi=float(row["rsi"]),
        atr=float(row["atr"]) if not pd.isna(row["atr"]) else 0.0,
    )
    if row["long_entry"]:
        return Signal(action=LONG_ENTRY,
                      reason=f"golden cross, RSI {row['rsi']:.1f} <= {params.rsi_overbought}",
                      **common)
    if row["golden_cross"] and not row["long_entry"]:
        return Signal(action=HOLD,
                      reason=f"golden cross skipped: RSI {row['rsi']:.1f} > {params.rsi_overbought}",
                      **common)
    if row["long_exit"]:
        return Signal(action=LONG_EXIT, reason="death cross", **common)
    if params.allow_shorts and row["short_entry"]:
        return Signal(action=SHORT_ENTRY,
                      reason=f"death cross, RSI {row['rsi']:.1f} >= {params.rsi_oversold}",
                      **common)
    if params.allow_shorts and row["short_exit"]:
        return Signal(action=SHORT_EXIT, reason="golden cross", **common)
    return Signal(action=HOLD, reason="no cross", **common)
