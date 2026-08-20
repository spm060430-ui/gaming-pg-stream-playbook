"""Persistent local state for the relay.

Tradovate is the source of truth for open positions and equity, but the relay
keeps its own metadata: entry day (for the min-hold/swing guard), assigned stop,
the day/week equity marks the circuit breaker needs, a halt flag, and a set of
recently processed alert IDs (idempotency -- TradingView can resend an alert).

Simple, human-readable JSON so you can inspect or hand-edit it.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from datetime import date, datetime
from typing import Dict, List, Optional


@dataclass
class PositionMeta:
    symbol: str
    side: str  # "long" or "short"
    entry_price: float
    entry_date: str
    stop: float
    contracts: int
    # Id of the resting protective stop order placed at the broker, if any.
    # Kept so we can cancel it when we exit for another reason.
    stop_order_id: Optional[str] = None

    @property
    def entry_day(self) -> date:
        return date.fromisoformat(self.entry_date)


@dataclass
class BotState:
    positions: Dict[str, PositionMeta] = field(default_factory=dict)
    day_start_equity: float = 0.0
    week_start_equity: float = 0.0
    day_mark_date: Optional[str] = None
    week_mark_date: Optional[str] = None
    halted: bool = False
    halt_reason: str = ""
    processed_alert_ids: List[str] = field(default_factory=list)
    last_run: Optional[str] = None

    def to_json(self) -> dict:
        d = asdict(self)
        d["positions"] = {k: asdict(v) for k, v in self.positions.items()}
        return d

    @classmethod
    def from_json(cls, d: dict) -> "BotState":
        positions = {k: PositionMeta(**v) for k, v in (d.get("positions") or {}).items()}
        return cls(
            positions=positions,
            day_start_equity=d.get("day_start_equity", 0.0),
            week_start_equity=d.get("week_start_equity", 0.0),
            day_mark_date=d.get("day_mark_date"),
            week_mark_date=d.get("week_mark_date"),
            halted=d.get("halted", False),
            halt_reason=d.get("halt_reason", ""),
            processed_alert_ids=d.get("processed_alert_ids", []),
            last_run=d.get("last_run"),
        )

    def remember_alert(self, alert_id: str, keep: int = 500) -> None:
        self.processed_alert_ids.append(alert_id)
        if len(self.processed_alert_ids) > keep:
            self.processed_alert_ids = self.processed_alert_ids[-keep:]

    def seen_alert(self, alert_id: str) -> bool:
        return alert_id in self.processed_alert_ids


def load_state(path: str) -> BotState:
    if not os.path.exists(path):
        return BotState()
    with open(path, "r") as f:
        return BotState.from_json(json.load(f))


def save_state(path: str, state: BotState) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    state.last_run = datetime.utcnow().isoformat()
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state.to_json(), f, indent=2, sort_keys=True)
    os.replace(tmp, path)


def week_monday(d: date) -> date:
    return date.fromordinal(d.toordinal() - d.weekday())


def roll_equity_marks(state: BotState, equity: float, today: date) -> None:
    today_iso = today.isoformat()
    if state.day_mark_date != today_iso:
        state.day_start_equity = equity
        state.day_mark_date = today_iso
    wk = week_monday(today).isoformat()
    if state.week_mark_date != wk:
        state.week_start_equity = equity
        state.week_mark_date = wk
