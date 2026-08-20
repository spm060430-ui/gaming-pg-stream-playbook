import os
import tempfile
from datetime import date

import pytest

from swingbot.config import Config, RelayConfig, RiskParams, StrategyParams
from swingbot.engine import AlertRejected, process_alert


class FakeBroker:
    def __init__(self, equity=5000.0):
        self._equity = equity
        self.orders = []

    def get_account(self):
        from swingbot.tradovate import Account
        return Account(id=1, spec="DEMO", equity=self._equity, cash=self._equity)

    def place_market_order(self, root, action, qty):
        from swingbot.tradovate import OrderResult
        self.orders.append(("order", root, action, qty))
        return OrderResult(order_id=len(self.orders), symbol=root, action=action,
                           qty=qty, status="Submitted", raw={})

    def flatten(self, root):
        from swingbot.tradovate import OrderResult
        self.orders.append(("flatten", root))
        return OrderResult(order_id=999, symbol=root, action="Flatten", qty=0,
                           status="Submitted", raw={})


def _cfg(tmp):
    cfg = Config()
    cfg.state_file = os.path.join(tmp, "state.json")
    cfg.relay = RelayConfig()
    cfg.relay.webhook_secret = "s3cret"
    cfg.relay.dry_run = False  # exercise the broker path
    cfg.risk = RiskParams(risk_per_trade_pct=0.10, max_contracts_per_symbol=3,
                          max_margin_pct=1.0, min_hold_days=1)
    cfg.strategy = StrategyParams()
    return cfg


def _alert(**kw):
    base = {"secret": "s3cret", "id": "a1", "action": "long_entry",
            "symbol": "MNQ", "price": 20000.0, "atr": 100.0, "rsi": 55.0}
    base.update(kw)
    return base


def test_bad_secret_rejected():
    with tempfile.TemporaryDirectory() as tmp:
        cfg = _cfg(tmp)
        with pytest.raises(AlertRejected):
            process_alert(_alert(secret="wrong"), cfg, FakeBroker())


def test_symbol_not_in_watchlist_rejected():
    with tempfile.TemporaryDirectory() as tmp:
        cfg = _cfg(tmp)
        with pytest.raises(AlertRejected):
            process_alert(_alert(symbol="AAPL"), cfg, FakeBroker())


def test_entry_then_duplicate_then_exit():
    with tempfile.TemporaryDirectory() as tmp:
        cfg = _cfg(tmp)
        broker = FakeBroker()
        r1 = process_alert(_alert(), cfg, broker, today=date(2025, 1, 10))
        assert r1.action_taken == "entered"
        assert broker.orders and broker.orders[0][2] == "Buy"

        # Duplicate id -> skipped, no new order.
        r2 = process_alert(_alert(), cfg, broker, today=date(2025, 1, 10))
        assert r2.action_taken == "skipped"

        # Same-day exit blocked by min-hold guard.
        r3 = process_alert(_alert(id="a2", action="long_exit"), cfg, broker,
                           today=date(2025, 1, 10))
        assert r3.action_taken == "held"

        # Next day exit works.
        r4 = process_alert(_alert(id="a3", action="long_exit"), cfg, broker,
                           today=date(2025, 1, 12))
        assert r4.action_taken == "exited"
        assert broker.orders[-1][0] == "flatten"


def test_max_positions_blocks_second_symbol_when_capped():
    with tempfile.TemporaryDirectory() as tmp:
        cfg = _cfg(tmp)
        cfg.risk.max_open_positions = 1
        broker = FakeBroker()
        process_alert(_alert(id="x1", symbol="MNQ"), cfg, broker, today=date(2025, 1, 10))
        r = process_alert(_alert(id="x2", symbol="MGC", price=2300.0, atr=20.0),
                          cfg, broker, today=date(2025, 1, 10))
        assert r.action_taken == "blocked"
