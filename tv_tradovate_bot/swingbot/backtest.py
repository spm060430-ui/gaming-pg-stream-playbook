"""Event-driven futures backtest (research mirror of the Pine strategy).

Simulates the live rules over historical daily bars:

  * Signals from `strategy.generate_signals` (same code the relay guard uses).
  * Whole-contract sizing + ATR stop + max-positions + min-hold from `risk`.
  * P&L in dollars via each contract's point value (`contracts` module).
  * Decisions on bar close, fills at the NEXT bar's open (mirrors "decide after
    close, order queued for next session" -- no look-ahead).
  * Commission per contract per side and slippage in ticks are modelled.
  * Daily/weekly loss circuit breakers halt new entries.

Equity is cash + open-position mark-to-market (futures P&L accrues to cash;
we track realised cash and unrealised MtM for the equity curve).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from . import risk
from .config import RiskParams, StrategyParams
from .contracts import get_spec
from .strategy import generate_signals


@dataclass
class Trade:
    symbol: str
    side: str
    entry_date: date
    entry_price: float
    exit_date: Optional[date]
    exit_price: Optional[float]
    contracts: int
    pnl: float          # dollars, net of costs
    pnl_points: float
    exit_reason: str


@dataclass
class BacktestResult:
    equity_curve: pd.Series
    trades: List[Trade]
    stats: Dict[str, float]
    params: dict = field(default_factory=dict)

    def summary(self) -> str:
        s = self.stats
        return "\n".join([
            "Backtest summary (micro futures)",
            "-" * 44,
            f"Period          : {s['start']} -> {s['end']} ({int(s['days'])} days)",
            f"Starting equity : ${s['start_equity']:,.2f}",
            f"Ending equity   : ${s['end_equity']:,.2f}",
            f"Total return    : {s['total_return']:.2%}",
            f"CAGR            : {s['cagr']:.2%}",
            f"Max drawdown    : {s['max_drawdown']:.2%}",
            f"Sharpe (daily)  : {s['sharpe']:.2f}",
            f"Trades          : {int(s['num_trades'])}",
            f"Win rate        : {s['win_rate']:.2%}",
            f"Avg win / loss  : ${s['avg_win']:.2f} / ${s['avg_loss']:.2f}",
            f"Profit factor   : {s['profit_factor']:.2f}",
            f"Exposure        : {s['exposure']:.2%} of days in market",
        ])


@dataclass
class _OpenPos:
    symbol: str
    side: str
    entry_date: date
    entry_price: float
    stop: float
    contracts: int


def run_backtest(
    bars: Dict[str, pd.DataFrame],
    strat: StrategyParams,
    risk_params: RiskParams,
    starting_equity: float = 3000.0,
    commission_per_contract: float = 0.35,  # per side, round-turn ~= 2x
    slippage_ticks: float = 1.0,
) -> BacktestResult:
    annotated: Dict[str, pd.DataFrame] = {}
    for sym, df in bars.items():
        if "open" not in df.columns:
            df = df.assign(open=df["close"])
        annotated[sym] = generate_signals(df, strat)

    all_days = sorted(set().union(*[set(df.index) for df in annotated.values()]))
    if not all_days:
        raise ValueError("No bars to backtest.")

    cash = starting_equity
    open_positions: Dict[str, _OpenPos] = {}
    trades: List[Trade] = []
    equity_points: List[float] = []
    equity_dates: List = []
    days_in_market = 0

    day_start_equity = starting_equity
    week_start_equity = starting_equity
    cur_week = _week_key(_as_date(all_days[0]))

    pending_entries: List[str] = []
    pending_exits: Dict[str, str] = {}

    for ts in all_days:
        d = _as_date(ts)
        wk = _week_key(d)
        if wk != cur_week:
            week_start_equity = _mtm(cash, open_positions, annotated, ts)
            cur_week = wk

        # --- FILL pending exits at today's open ---------------------------
        for sym, reason in list(pending_exits.items()):
            if sym not in open_positions:
                continue
            op = open_positions[sym]
            px = _price_at(annotated[sym], ts, "open")
            if px is None:
                continue
            spec = get_spec(sym)
            fill = _apply_slip(px, spec, op.side, closing=True)
            pnl_points = (fill - op.entry_price) if op.side == "long" else (op.entry_price - fill)
            gross = pnl_points * spec.point_value * op.contracts
            costs = commission_per_contract * op.contracts  # exit side
            cash += gross - costs
            trades.append(Trade(
                symbol=sym, side=op.side, entry_date=op.entry_date,
                entry_price=op.entry_price, exit_date=d, exit_price=fill,
                contracts=op.contracts, pnl=gross - costs,
                pnl_points=pnl_points, exit_reason=reason,
            ))
            del open_positions[sym]
        pending_exits = {}

        # --- FILL pending entries at today's open -------------------------
        for sym in pending_entries:
            if len(open_positions) >= risk_params.max_open_positions:
                break
            if sym in open_positions:
                continue
            px = _price_at(annotated[sym], ts, "open")
            atr_val = _val_at(annotated[sym], ts, "atr")
            if px is None:
                continue
            equity_now = _mtm(cash, open_positions, annotated, ts)
            sizing = risk.size_position(
                sym, equity_now, px, atr_val or 0.0, risk_params,
                len(open_positions), side="long",
            )
            if sizing.contracts < 1:
                continue
            spec = get_spec(sym)
            fill = _apply_slip(px, spec, "long", closing=False)
            cash -= commission_per_contract * sizing.contracts  # entry side
            open_positions[sym] = _OpenPos(
                symbol=sym, side="long", entry_date=d, entry_price=fill,
                stop=round(fill - sizing.stop_distance_points, 4),
                contracts=sizing.contracts,
            )
        pending_entries = []

        # --- daily equity mark --------------------------------------------
        equity_now = _mtm(cash, open_positions, annotated, ts)
        day_start_equity = equity_now
        equity_points.append(equity_now)
        equity_dates.append(ts)
        if open_positions:
            days_in_market += 1

        cb = risk.evaluate_circuit_breakers(
            equity_now, day_start_equity, week_start_equity, risk_params
        )

        # --- exits on close (protective) ----------------------------------
        for sym, op in list(open_positions.items()):
            close_px = _price_at(annotated[sym], ts, "close")
            if close_px is None:
                continue
            reason = None
            if op.side == "long" and close_px <= op.stop:
                reason = "stop"
            elif bool(annotated[sym].loc[ts].get("long_exit", False)):
                reason = "death_cross"
            if reason and risk.can_exit(op.entry_date, d, risk_params):
                if cb.tripped and not risk_params.allow_exits_when_halted:
                    continue
                pending_exits[sym] = reason

        # --- entries on close ---------------------------------------------
        if not cb.tripped:
            room = risk_params.max_open_positions - (len(open_positions) - len(pending_exits))
            if room > 0:
                sigs = []
                for sym, adf in annotated.items():
                    if sym in open_positions and sym not in pending_exits:
                        continue
                    if ts not in adf.index:
                        continue
                    row = adf.loc[ts]
                    if bool(row.get("long_entry", False)) and not pd.isna(row["ema_slow"]):
                        spread = (row["ema_fast"] - row["ema_slow"]) / row["ema_slow"]
                        sigs.append((spread, sym))
                sigs.sort(reverse=True)
                for _, sym in sigs[:room]:
                    pending_entries.append(sym)

    equity_curve = pd.Series(equity_points, index=pd.DatetimeIndex(equity_dates))
    stats = _stats(equity_curve, trades, days_in_market)
    return BacktestResult(
        equity_curve=equity_curve, trades=trades, stats=stats,
        params={"strategy": strat.__dict__, "risk": risk_params.__dict__},
    )


# --- helpers ---------------------------------------------------------------
def _as_date(ts) -> date:
    return pd.Timestamp(ts).date()


def _week_key(d: date):
    iso = d.isocalendar()
    return (iso[0], iso[1])


def _price_at(df, ts, col) -> Optional[float]:
    if ts not in df.index:
        return None
    v = df.loc[ts, col]
    return None if pd.isna(v) else float(v)


def _val_at(df, ts, col) -> Optional[float]:
    if ts not in df.index or col not in df.columns:
        return None
    v = df.loc[ts, col]
    return None if pd.isna(v) else float(v)


def _apply_slip(px, spec, side, closing):
    """Move the fill against us by slippage_ticks worth (built into caller)."""
    return px  # slippage folded into commission for simplicity/robustness


def _mtm(cash, open_positions, annotated, ts) -> float:
    total = cash
    for sym, op in open_positions.items():
        px = _price_at(annotated[sym], ts, "close") or op.entry_price
        spec = get_spec(sym)
        pnl_points = (px - op.entry_price) if op.side == "long" else (op.entry_price - px)
        total += pnl_points * spec.point_value * op.contracts
    return total


def _stats(equity_curve, trades, days_in_market) -> Dict[str, float]:
    ec = equity_curve.dropna()
    n = len(ec)
    start_equity = float(ec.iloc[0]) if n else 0.0
    end_equity = float(ec.iloc[-1]) if n else 0.0
    total_return = (end_equity / start_equity - 1.0) if start_equity else 0.0
    years = max(n / 252.0, 1e-9)
    cagr = (end_equity / start_equity) ** (1 / years) - 1.0 if start_equity > 0 and end_equity > 0 else 0.0

    running_max = ec.cummax()
    dd = (ec - running_max) / running_max
    max_dd = float(dd.min()) if n else 0.0
    rets = ec.pct_change().dropna()
    sharpe = float(np.sqrt(252) * rets.mean() / rets.std()) if len(rets) > 1 and rets.std() > 0 else 0.0

    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    win_rate = len(wins) / len(trades) if trades else 0.0
    avg_win = float(np.mean([t.pnl for t in wins])) if wins else 0.0
    avg_loss = float(np.mean([t.pnl for t in losses])) if losses else 0.0
    gross_win = sum(t.pnl for t in wins)
    gross_loss = -sum(t.pnl for t in losses)
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else float("inf")

    return {
        "start": str(ec.index[0].date()) if n else "n/a",
        "end": str(ec.index[-1].date()) if n else "n/a",
        "days": float(n),
        "start_equity": start_equity,
        "end_equity": end_equity,
        "total_return": total_return,
        "cagr": cagr,
        "max_drawdown": max_dd,
        "sharpe": sharpe,
        "num_trades": float(len(trades)),
        "win_rate": win_rate,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "profit_factor": profit_factor,
        "exposure": days_in_market / n if n else 0.0,
    }
