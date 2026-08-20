"""Risk management for micro futures.

Pure/deterministic: given account numbers, a signal and parameters it returns a
sizing/exit decision. It never talks to the broker, so the guardrails are
trivially testable and fully auditable.

Key futures differences from the stock version:
  * Sizing is in WHOLE contracts (no fractional). We floor by dollar risk.
  * A percentage stop is inappropriate; the stop distance is derived from ATR
    (default), a fixed point distance, or a percent -- configurable.
  * Dollar risk = stop_distance_points * point_value * contracts.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from math import floor
from typing import Optional

from .config import RiskParams
from .contracts import get_spec


@dataclass
class SizingResult:
    contracts: int
    stop_distance_points: float
    stop_price: float
    dollar_risk: float
    reason: str


def stop_distance_points(
    entry_price: float, atr_value: float, params: RiskParams
) -> float:
    """Stop distance in price points, per the configured stop mode."""
    if params.stop_mode == "atr":
        if atr_value and atr_value > 0:
            return params.stop_atr_mult * atr_value
        # Fall back to percent if ATR is unavailable.
        return entry_price * params.stop_percent
    if params.stop_mode == "points":
        return params.stop_points
    # percent
    return entry_price * params.stop_percent


def size_position(
    symbol: str,
    equity: float,
    entry_price: float,
    atr_value: float,
    params: RiskParams,
    open_positions: int,
    side: str = "long",
) -> SizingResult:
    """How many whole contracts to trade, floored by risk and margin.

    Steps:
      1. Risk budget = risk_per_trade_pct * equity.
      2. Per-contract risk = stop_distance_points * point_value.
      3. contracts = floor(risk_budget / per_contract_risk), then capped by
         max_contracts_per_symbol and by margin (max_margin_pct * equity).
    """
    spec = get_spec(symbol)
    if open_positions >= params.max_open_positions:
        return SizingResult(0, 0, 0, 0, "at max open positions")
    if entry_price <= 0 or equity <= 0:
        return SizingResult(0, 0, 0, 0, "invalid price/equity")

    dist = stop_distance_points(entry_price, atr_value, params)
    if dist <= 0:
        return SizingResult(0, 0, 0, 0, "stop distance resolved to 0")

    per_contract_risk = dist * spec.point_value
    risk_budget = equity * params.risk_per_trade_pct
    if per_contract_risk > risk_budget:
        return SizingResult(
            0, dist, 0, 0,
            f"1 contract risks ${per_contract_risk:.0f} > budget ${risk_budget:.0f}",
        )

    contracts = floor(risk_budget / per_contract_risk)
    contracts = min(contracts, params.max_contracts_per_symbol)

    # Margin sanity cap.
    max_by_margin = floor((equity * params.max_margin_pct) / spec.initial_margin)
    contracts = min(contracts, max(max_by_margin, 0))

    if contracts < 1:
        return SizingResult(
            0, dist, 0, 0,
            f"margin/risk caps size below 1 contract (margin cap {max_by_margin})",
        )

    if side == "long":
        stop = round(entry_price - dist, 4)
    else:
        stop = round(entry_price + dist, 4)

    dollar_risk = contracts * per_contract_risk
    return SizingResult(
        contracts=contracts,
        stop_distance_points=round(dist, 4),
        stop_price=stop,
        dollar_risk=round(dollar_risk, 2),
        reason=(
            f"{contracts}x {symbol} risking ${dollar_risk:.0f} "
            f"(stop {dist:.2f}pts = ${per_contract_risk:.0f}/contract)"
        ),
    )


# --- hold-time / exits -----------------------------------------------------
def hold_days(entry_day: date, today: date) -> int:
    return (today - entry_day).days


def can_exit(entry_day: date, today: date, params: RiskParams) -> bool:
    """Swing guard: hold at least min_hold_days before exiting (no same-day flip)."""
    return hold_days(entry_day, today) >= params.min_hold_days


# --- circuit breakers ------------------------------------------------------
@dataclass
class CircuitBreakerStatus:
    tripped: bool
    daily_loss_pct: float
    weekly_loss_pct: float
    reason: str


def evaluate_circuit_breakers(
    equity: float, day_start_equity: float, week_start_equity: float, params: RiskParams
) -> CircuitBreakerStatus:
    daily = max(0.0, (day_start_equity - equity) / day_start_equity) if day_start_equity > 0 else 0.0
    weekly = max(0.0, (week_start_equity - equity) / week_start_equity) if week_start_equity > 0 else 0.0
    reasons = []
    if daily >= params.daily_max_loss_pct:
        reasons.append(f"daily loss {daily:.2%} >= {params.daily_max_loss_pct:.2%}")
    if weekly >= params.weekly_max_loss_pct:
        reasons.append(f"weekly loss {weekly:.2%} >= {params.weekly_max_loss_pct:.2%}")
    return CircuitBreakerStatus(
        tripped=bool(reasons),
        daily_loss_pct=daily,
        weekly_loss_pct=weekly,
        reason="; ".join(reasons) if reasons else "ok",
    )
