"""Central configuration.

All tunable knobs live here or come from the environment / .env. Secrets
(Tradovate credentials, webhook secret, SMTP password) are read from the
environment and never logged or written to disk.

The instruments are micro futures: MNQ (Micro Nasdaq-100) and MGC (Micro Gold).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from typing import List, Optional

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover
    pass


def _f(name: str, default: float) -> float:
    v = os.getenv(name)
    return float(v) if v not in (None, "") else default


def _i(name: str, default: int) -> int:
    v = os.getenv(name)
    return int(v) if v not in (None, "") else default


def _b(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v in (None, ""):
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


# The two instruments requested: Micro Nasdaq and Micro Gold.
DEFAULT_WATCHLIST = ["MNQ", "MGC"]


@dataclass
class StrategyParams:
    """Signal parameters -- mirror these in the Pine strategy inputs."""

    ema_fast: int = _i("EMA_FAST", 10)
    ema_slow: int = _i("EMA_SLOW", 30)
    rsi_period: int = _i("RSI_PERIOD", 14)
    rsi_overbought: float = _f("RSI_OVERBOUGHT", 70.0)  # don't BUY above this
    rsi_oversold: float = _f("RSI_OVERSOLD", 30.0)      # don't SHORT below this
    # Futures cut both ways cheaply and there is no PDT rule, so shorts are
    # reasonable here -- but default off until you've validated the long side.
    allow_shorts: bool = _b("ALLOW_SHORTS", False)
    atr_period: int = _i("ATR_PERIOD", 14)


@dataclass
class RiskParams:
    """Risk guardrails. Sizing is in WHOLE contracts (no fractional futures)."""

    max_open_positions: int = _i("MAX_OPEN_POSITIONS", 2)
    max_contracts_per_symbol: int = _i("MAX_CONTRACTS_PER_SYMBOL", 2)

    # --- Stop-loss ---------------------------------------------------------
    # For futures a percentage stop is far too wide (6% of MNQ ~ $2.4k/contract).
    # We stop on ATR distance by default. "atr" or "points" or "percent".
    stop_mode: str = os.getenv("STOP_MODE", "atr")
    stop_atr_mult: float = _f("STOP_ATR_MULT", 2.0)      # stop = entry -/+ mult*ATR
    stop_points: float = _f("STOP_POINTS", 0.0)          # used when stop_mode=points
    stop_percent: float = _f("STOP_PERCENT", 0.06)       # used when stop_mode=percent

    # --- Sizing ------------------------------------------------------------
    # Risk this fraction of equity per trade; contracts are floored so dollar
    # risk (stop distance x point value x contracts) stays within budget.
    risk_per_trade_pct: float = _f("RISK_PER_TRADE_PCT", 0.01)
    # Never let one position's margin exceed this fraction of equity.
    max_margin_pct: float = _f("MAX_MARGIN_PCT", 0.5)
    min_hold_days: int = _i("MIN_HOLD_DAYS", 1)  # swing, not intraday

    # --- Circuit breakers --------------------------------------------------
    daily_max_loss_pct: float = _f("DAILY_MAX_LOSS_PCT", 0.05)
    weekly_max_loss_pct: float = _f("WEEKLY_MAX_LOSS_PCT", 0.08)
    allow_exits_when_halted: bool = _b("ALLOW_EXITS_WHEN_HALTED", True)


@dataclass
class TradovateConfig:
    """Tradovate API connection. DEMO by default -- live is an explicit choice."""

    # "demo" or "live". Practice happens on demo; real money on live only after
    # a long successful paper/demo run.
    env: str = os.getenv("TRADOVATE_ENV", "demo")
    username: Optional[str] = field(default_factory=lambda: os.getenv("TRADOVATE_USERNAME"))
    password: Optional[str] = field(default_factory=lambda: os.getenv("TRADOVATE_PASSWORD"))
    app_id: Optional[str] = field(default_factory=lambda: os.getenv("TRADOVATE_APP_ID"))
    app_version: str = os.getenv("TRADOVATE_APP_VERSION", "1.0")
    cid: Optional[str] = field(default_factory=lambda: os.getenv("TRADOVATE_CID"))
    sec: Optional[str] = field(default_factory=lambda: os.getenv("TRADOVATE_SECRET"))
    # Which Tradovate account to trade (spec name, e.g. "DEMO12345"). If unset
    # the client uses the first account it finds.
    account_spec: Optional[str] = field(
        default_factory=lambda: os.getenv("TRADOVATE_ACCOUNT_SPEC")
    )

    @property
    def base_url(self) -> str:
        return (
            "https://live.tradovateapi.com/v1"
            if self.env == "live"
            else "https://demo.tradovateapi.com/v1"
        )


@dataclass
class RelayConfig:
    """Webhook relay server settings."""

    host: str = os.getenv("RELAY_HOST", "0.0.0.0")
    port: int = _i("RELAY_PORT", 8000)
    # Shared secret that TradingView must include in the alert JSON. Reject any
    # webhook without the exact match -- the endpoint is public.
    webhook_secret: Optional[str] = field(
        default_factory=lambda: os.getenv("WEBHOOK_SECRET")
    )
    # If true the relay logs the order it WOULD place but does not call Tradovate.
    dry_run: bool = _b("RELAY_DRY_RUN", True)


@dataclass
class NotifyConfig:
    enabled: bool = _b("NOTIFY_ENABLED", False)
    smtp_host: Optional[str] = field(default_factory=lambda: os.getenv("SMTP_HOST"))
    smtp_port: int = _i("SMTP_PORT", 587)
    smtp_user: Optional[str] = field(default_factory=lambda: os.getenv("SMTP_USER"))
    smtp_password: Optional[str] = field(default_factory=lambda: os.getenv("SMTP_PASSWORD"))
    email_from: Optional[str] = field(default_factory=lambda: os.getenv("EMAIL_FROM"))
    email_to: Optional[str] = field(default_factory=lambda: os.getenv("EMAIL_TO"))


@dataclass
class Config:
    watchlist: List[str] = field(default_factory=lambda: _load_watchlist())
    strategy: StrategyParams = field(default_factory=StrategyParams)
    risk: RiskParams = field(default_factory=RiskParams)
    tradovate: TradovateConfig = field(default_factory=TradovateConfig)
    relay: RelayConfig = field(default_factory=RelayConfig)
    notify: NotifyConfig = field(default_factory=NotifyConfig)

    state_file: str = os.getenv("STATE_FILE", "data/state.json")
    log_dir: str = os.getenv("LOG_DIR", "logs")
    history_days: int = _i("HISTORY_DAYS", 400)

    def redacted(self) -> dict:
        d = asdict(self)
        d["tradovate"]["password"] = _mask(self.tradovate.password)
        d["tradovate"]["sec"] = _mask(self.tradovate.sec)
        d["relay"]["webhook_secret"] = _mask(self.relay.webhook_secret)
        d["notify"]["smtp_password"] = _mask(self.notify.smtp_password)
        return d


def _mask(secret: Optional[str]) -> Optional[str]:
    if not secret:
        return None
    return secret[:3] + "***"


def _load_watchlist() -> List[str]:
    raw = os.getenv("WATCHLIST")
    if not raw:
        return list(DEFAULT_WATCHLIST)
    syms = [s.strip().upper() for s in raw.split(",") if s.strip()]
    return syms or list(DEFAULT_WATCHLIST)


def load_config() -> Config:
    return Config()
