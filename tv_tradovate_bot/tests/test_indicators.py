import numpy as np
import pandas as pd

from swingbot.indicators import atr, ema, rsi


def test_ema_converges_to_constant():
    s = pd.Series([5.0] * 50)
    assert abs(ema(s, 10).iloc[-1] - 5.0) < 1e-9


def test_rsi_bounds_and_all_up():
    # Monotonically rising series -> RSI should be at/near 100.
    s = pd.Series(np.arange(1, 60, dtype=float))
    r = rsi(s, 14).dropna()
    assert (r <= 100.0 + 1e-9).all() and (r >= 0.0 - 1e-9).all()
    assert r.iloc[-1] > 99.0


def test_rsi_all_down():
    s = pd.Series(np.arange(60, 1, -1, dtype=float))
    r = rsi(s, 14).dropna()
    assert r.iloc[-1] < 1.0


def test_atr_positive():
    n = 40
    df = pd.DataFrame({
        "high": np.linspace(10, 20, n) + 0.5,
        "low": np.linspace(10, 20, n) - 0.5,
        "close": np.linspace(10, 20, n),
    })
    a = atr(df, 14).dropna()
    assert (a > 0).all()
