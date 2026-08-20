import numpy as np
import pandas as pd

from swingbot.backtest import run_backtest
from swingbot.config import RiskParams, StrategyParams
from swingbot.strategy import generate_signals, latest_signal
from swingbot.synthetic import make_watchlist


def _crossover_frame():
    # Build a series that clearly crosses up then down.
    up = np.linspace(100, 130, 40)
    down = np.linspace(130, 105, 40)
    close = np.concatenate([up, down])
    idx = pd.bdate_range("2024-01-01", periods=len(close))
    return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1,
                         "close": close, "volume": 1000}, index=idx)


def test_generate_signals_has_columns():
    df = _crossover_frame()
    out = generate_signals(df, StrategyParams())
    for col in ["ema_fast", "ema_slow", "rsi", "atr", "golden_cross",
                "death_cross", "long_entry", "long_exit"]:
        assert col in out.columns


def test_latest_signal_returns_signal():
    df = _crossover_frame()
    sig = latest_signal("MNQ", df, StrategyParams())
    assert sig is not None
    assert sig.action in {"LONG_ENTRY", "LONG_EXIT", "HOLD"}


def test_backtest_runs_and_reports():
    bars = make_watchlist(["MNQ", "MGC"], days=500)
    res = run_backtest(bars, StrategyParams(), RiskParams(risk_per_trade_pct=0.10,
                       max_contracts_per_symbol=3), starting_equity=5000)
    assert len(res.equity_curve) > 100
    assert "total_return" in res.stats
    # Equity curve should never go NaN.
    assert not res.equity_curve.isna().any()
    # Summary renders.
    assert "Backtest summary" in res.summary()
