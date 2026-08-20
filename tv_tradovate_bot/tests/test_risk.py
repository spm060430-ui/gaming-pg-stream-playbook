from datetime import date

from swingbot.config import RiskParams
from swingbot.risk import (
    can_exit,
    evaluate_circuit_breakers,
    size_position,
    stop_distance_points,
)


def test_atr_stop_distance():
    p = RiskParams(stop_mode="atr", stop_atr_mult=2.0)
    assert stop_distance_points(20000, 100.0, p) == 200.0


def test_sizing_whole_contracts_and_risk_cap():
    # MNQ point value $2. ATR 100, mult 2 => stop 200 pts => $400/contract risk.
    # Equity 5000, risk 1% => $50 budget < $400 => 0 contracts (too risky).
    p = RiskParams(stop_mode="atr", stop_atr_mult=2.0, risk_per_trade_pct=0.01)
    r = size_position("MNQ", 5000, 20000, 100.0, p, open_positions=0)
    assert r.contracts == 0

    # Larger budget: risk 10% => $500 budget / $400 => 1 contract.
    p2 = RiskParams(stop_mode="atr", stop_atr_mult=2.0, risk_per_trade_pct=0.10,
                    max_contracts_per_symbol=5, max_margin_pct=1.0)
    r2 = size_position("MNQ", 5000, 20000, 100.0, p2, open_positions=0)
    assert r2.contracts == 1
    assert r2.stop_price == 20000 - 200


def test_sizing_blocks_at_max_positions():
    p = RiskParams(max_open_positions=2)
    r = size_position("MGC", 10000, 2300, 20.0, p, open_positions=2)
    assert r.contracts == 0
    assert "max open positions" in r.reason


def test_min_hold_guard():
    p = RiskParams(min_hold_days=1)
    assert not can_exit(date(2025, 1, 10), date(2025, 1, 10), p)  # same day
    assert can_exit(date(2025, 1, 10), date(2025, 1, 11), p)


def test_circuit_breaker_trips():
    p = RiskParams(daily_max_loss_pct=0.05, weekly_max_loss_pct=0.08)
    cb = evaluate_circuit_breakers(9400, 10000, 10000, p)  # -6% day
    assert cb.tripped
    cb2 = evaluate_circuit_breakers(9800, 10000, 10000, p)  # -2% day
    assert not cb2.tripped
