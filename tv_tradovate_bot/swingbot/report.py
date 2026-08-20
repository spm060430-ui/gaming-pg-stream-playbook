"""Daily summary report.

Builds a plain-text snapshot of the account and the bot's state -- meant to run
on a schedule (e.g. once after the futures daily settlement) so you get a record
even on days with no trades. Uses Tradovate for equity/positions and local state
for the bot's view.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import List, Optional

from . import risk
from .config import Config
from .logging_setup import get_logger
from .notify import alert
from .state import load_state, roll_equity_marks, save_state

log = get_logger(__name__)


def build_daily_report(cfg: Config, broker) -> str:
    run_time = datetime.now(timezone.utc)
    state = load_state(cfg.state_file)

    equity = cash = 0.0
    positions_lines: List[str] = []
    broker_err: Optional[str] = None
    if broker is not None:
        try:
            acct = broker.get_account()
            equity, cash = acct.equity, acct.cash
            for sym, p in broker.list_positions().items():
                positions_lines.append(
                    f"  {sym:<8} {p.side:<5} net={p.net_pos:<3} avg=${p.avg_price:,.2f}"
                )
        except Exception as e:  # noqa: BLE001
            broker_err = str(e)

    roll_equity_marks(state, equity, run_time.date())
    cb = risk.evaluate_circuit_breakers(
        equity, state.day_start_equity, state.week_start_equity, cfg.risk
    )

    lines = [
        "=" * 60,
        f" SWING BOT DAILY REPORT  {run_time:%Y-%m-%d %H:%M UTC}",
        f" env={cfg.tradovate.env}  dry_run={cfg.relay.dry_run}",
        "=" * 60,
        "",
        "ACCOUNT",
        f"  Equity (netLiq): ${equity:,.2f}",
        f"  Cash           : ${cash:,.2f}",
    ]
    if broker_err:
        lines.append(f"  Broker error   : {broker_err}")
    lines += [
        "",
        "CIRCUIT BREAKER",
        f"  Daily loss : {cb.daily_loss_pct:.2%}",
        f"  Weekly loss: {cb.weekly_loss_pct:.2%}",
        f"  Status     : {'TRIPPED' if cb.tripped else 'ok'} ({cb.reason})",
    ]
    if state.halted:
        lines.append(f"  HALTED     : {state.halt_reason}")
    lines += ["", "OPEN POSITIONS (broker)"]
    lines += positions_lines or ["  (none)"]
    lines += ["", "BOT-TRACKED POSITIONS"]
    if state.positions:
        for sym, m in state.positions.items():
            lines.append(
                f"  {sym:<8} {m.side:<5} {m.contracts}x entry=${m.entry_price:,.2f} "
                f"stop=${m.stop:,.2f} since {m.entry_date}"
            )
    else:
        lines.append("  (none)")
    lines += ["", "=" * 60]

    text = "\n".join(lines)
    _save(cfg.log_dir, run_time, text)
    save_state(cfg.state_file, state)
    if cfg.notify.enabled:
        alert(cfg.notify, f"Daily report {run_time:%Y-%m-%d}", text, level="info")
    return text


def _save(log_dir: str, run_time: datetime, text: str) -> str:
    out_dir = os.path.join(log_dir, "reports")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"report_{run_time:%Y%m%d_%H%M%S}.txt")
    with open(path, "w") as f:
        f.write(text)
    log.info("Report saved to %s", path)
    return path
