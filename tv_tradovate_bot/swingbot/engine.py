"""Relay decision engine.

Turns a validated TradingView alert into a broker action, applying an
INDEPENDENT server-side risk layer on top of whatever the Pine strategy decided:

    alert -> dedupe -> circuit breaker -> risk sizing / hold guard -> order

Kept free of any web framework so it is unit-testable with a fake broker. The
FastAPI app in relay/server.py is a thin wrapper around `process_alert`.

Alert payload contract (see pine/swing_strategy.pine and README):
    {
      "secret":  "<shared secret>",
      "id":      "<unique per bar, for idempotency>",
      "action":  "long_entry"|"long_exit"|"short_entry"|"short_exit"|"flat",
      "symbol":  "MNQ",
      "price":   20000.0,
      "atr":     120.0,       # optional but recommended (for ATR stop sizing)
      "rsi":     55.0         # optional, informational
    }
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Optional

from . import risk
from .config import Config
from .logging_setup import get_logger
from .notify import alert as send_alert
from .state import BotState, PositionMeta, load_state, roll_equity_marks, save_state

log = get_logger(__name__)

VALID_ACTIONS = {"long_entry", "long_exit", "short_entry", "short_exit", "flat"}


@dataclass
class AlertResult:
    accepted: bool
    action_taken: str
    detail: str
    order_id: Optional[str] = None


class AlertRejected(Exception):
    """Raised for auth/validation failures -> HTTP 4xx."""


def validate_alert(payload: dict, cfg: Config) -> dict:
    """Validate shape + shared secret. Raises AlertRejected on failure."""
    if not isinstance(payload, dict):
        raise AlertRejected("payload is not a JSON object")
    secret = payload.get("secret")
    if not cfg.relay.webhook_secret:
        raise AlertRejected("relay has no WEBHOOK_SECRET configured; refusing all alerts")
    if secret != cfg.relay.webhook_secret:
        raise AlertRejected("bad or missing secret")
    action = str(payload.get("action", "")).lower()
    if action not in VALID_ACTIONS:
        raise AlertRejected(f"unknown action '{action}'")
    symbol = str(payload.get("symbol", "")).upper()
    if symbol not in [s.upper() for s in cfg.watchlist]:
        raise AlertRejected(f"symbol '{symbol}' not in watchlist {cfg.watchlist}")
    try:
        float(payload.get("price"))
    except (TypeError, ValueError):
        raise AlertRejected("price missing or not numeric")
    return {
        "id": str(payload.get("id") or ""),
        "action": action,
        "symbol": symbol,
        "price": float(payload["price"]),
        "atr": float(payload.get("atr") or 0.0),
        "rsi": float(payload.get("rsi") or 0.0),
    }


def process_alert(
    payload: dict,
    cfg: Config,
    broker,  # TradovateClient or fake; may be None in pure dry-run
    today: Optional[date] = None,
) -> AlertResult:
    """Process one validated-or-raw alert. Returns an AlertResult.

    `broker` None or cfg.relay.dry_run True => no live order is placed; the
    decision is still fully computed and logged.
    """
    alert = validate_alert(payload, cfg)
    today = today or datetime.now(timezone.utc).date()
    state = load_state(cfg.state_file)

    # Idempotency: TradingView can resend an alert; process each id once.
    if alert["id"] and state.seen_alert(alert["id"]):
        return AlertResult(True, "skipped", f"duplicate alert id {alert['id']}")

    # Equity for sizing + circuit breaker.
    equity = _get_equity(cfg, broker)
    roll_equity_marks(state, equity, today)
    cb = risk.evaluate_circuit_breakers(
        equity, state.day_start_equity, state.week_start_equity, cfg.risk
    )
    if cb.tripped and not state.halted:
        state.halted = True
        state.halt_reason = cb.reason
        send_alert(cfg.notify, "Circuit breaker tripped", cb.reason, level="error")

    symbol = alert["symbol"]
    action = alert["action"]
    result: AlertResult

    try:
        if action in ("long_exit", "short_exit", "flat"):
            result = _handle_exit(cfg, broker, state, alert, today, cb)
        else:  # long_entry / short_entry
            result = _handle_entry(cfg, broker, state, alert, today, equity, cb)
    except Exception as e:  # noqa: BLE001 -- halt & alert, never fail silently
        state.halted = True
        state.halt_reason = f"error handling {action} {symbol}: {e}"
        send_alert(cfg.notify, "Relay error -- HALTED", state.halt_reason, level="error")
        save_state(cfg.state_file, state)
        raise

    if alert["id"]:
        state.remember_alert(alert["id"])
    save_state(cfg.state_file, state)
    log.info("ALERT %s %s -> %s (%s)", action, symbol, result.action_taken, result.detail)
    return result


def _handle_entry(cfg, broker, state: BotState, alert, today, equity, cb) -> AlertResult:
    symbol = alert["symbol"]
    side = "long" if alert["action"] == "long_entry" else "short"
    if side == "short" and not cfg.strategy.allow_shorts:
        return AlertResult(True, "ignored", "shorts disabled in config")
    if state.halted or cb.tripped:
        return AlertResult(True, "blocked", f"halted/circuit breaker: {state.halt_reason or cb.reason}")
    if symbol in state.positions:
        return AlertResult(True, "ignored", f"already in {symbol}")
    if len(state.positions) >= cfg.risk.max_open_positions:
        return AlertResult(True, "blocked", "at max open positions")

    sizing = risk.size_position(
        symbol, equity, alert["price"], alert["atr"], cfg.risk,
        len(state.positions), side=side,
    )
    if sizing.contracts < 1:
        return AlertResult(True, "skipped", f"sizing: {sizing.reason}")

    action_word = "Buy" if side == "long" else "Sell"
    order_id = None
    if broker is None or cfg.relay.dry_run:
        detail = f"[dry-run] {action_word} {sizing.contracts}x {symbol}; {sizing.reason}"
    else:
        res = broker.place_market_order(symbol, action_word, sizing.contracts)
        order_id = str(res.order_id) if res.order_id is not None else None
        detail = f"{action_word} {sizing.contracts}x {symbol} -> {res.status}; {sizing.reason}"

    state.positions[symbol] = PositionMeta(
        symbol=symbol, side=side, entry_price=alert["price"],
        entry_date=today.isoformat(), stop=sizing.stop_price, contracts=sizing.contracts,
    )
    return AlertResult(True, "entered", detail, order_id=order_id)


def _handle_exit(cfg, broker, state: BotState, alert, today, cb) -> AlertResult:
    symbol = alert["symbol"]
    meta = state.positions.get(symbol)
    if meta is None:
        return AlertResult(True, "ignored", f"no tracked position in {symbol}")

    # Swing guard: never close before min_hold_days (no same-day flip).
    if not risk.can_exit(meta.entry_day, today, cfg.risk):
        return AlertResult(True, "held", f"min-hold guard (entered {meta.entry_date})")

    if cb.tripped and not cfg.risk.allow_exits_when_halted:
        return AlertResult(True, "blocked", "exits disabled while halted")

    order_id = None
    if broker is None or cfg.relay.dry_run:
        detail = f"[dry-run] flatten {symbol}"
    else:
        res = broker.flatten(symbol)
        order_id = str(res.order_id) if res.order_id is not None else None
        detail = f"flatten {symbol} -> {res.status}"

    state.positions.pop(symbol, None)
    return AlertResult(True, "exited", detail, order_id=order_id)


def _get_equity(cfg: Config, broker) -> float:
    """Equity for sizing/circuit breaker. Falls back to a configured paper value
    when no broker is wired (pure dry-run without credentials)."""
    if broker is None:
        import os

        return float(os.getenv("DRY_RUN_EQUITY", "3000"))
    try:
        return broker.get_account().equity or float(__import__("os").getenv("DRY_RUN_EQUITY", "3000"))
    except Exception as e:  # noqa: BLE001
        log.warning("Could not read equity from broker (%s); using DRY_RUN_EQUITY", e)
        import os

        return float(os.getenv("DRY_RUN_EQUITY", "3000"))
