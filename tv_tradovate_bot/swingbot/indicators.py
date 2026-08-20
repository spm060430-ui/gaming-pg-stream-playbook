"""Technical indicators: EMA, RSI, ATR.

Pure pandas so the exact same code computes indicators in the backtest and the
relay. These are written to match TradingView's Pine built-ins as closely as
possible (ta.ema, ta.rsi, ta.atr with RMA smoothing) so Python research and
Pine live-trading agree.
"""
from __future__ import annotations

import pandas as pd


def ema(series: pd.Series, period: int) -> pd.Series:
    """EMA matching Pine's ta.ema (recursive, adjust=False)."""
    return series.ewm(span=period, adjust=False).mean()


def rma(series: pd.Series, period: int) -> pd.Series:
    """Wilder's RMA == Pine's ta.rma (EMA with alpha = 1/period)."""
    return series.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """RSI matching Pine's ta.rsi (Wilder smoothing). Values in [0, 100]."""
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = rma(gain, period)
    avg_loss = rma(loss, period)
    rs = avg_gain / avg_loss
    out = 100.0 - (100.0 / (1.0 + rs))
    out = out.where(avg_loss != 0, 100.0)
    return out


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average True Range matching Pine's ta.atr (RMA of true range).

    Requires 'high', 'low', 'close' columns.
    """
    high = df["high"]
    low = df["low"]
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            (high - low),
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return rma(tr, period)
