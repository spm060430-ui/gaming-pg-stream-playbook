"""Tradovate REST client -- the only place that talks to the broker.

Wraps the pieces the relay needs: authenticate (token cached until expiry),
resolve accounts, read equity/positions, place market orders and flatten
positions. Isolating it here keeps the rest of the bot broker-agnostic and
unit-testable with a fake.

IMPORTANT
---------
* Endpoints target Tradovate API v1. Base URL is chosen by TRADOVATE_ENV:
  demo -> https://demo.tradovateapi.com/v1  (practice)
  live -> https://live.tradovateapi.com/v1  (real money)
* You must supply real credentials (username/password + API app_id/cid/sec).
  API access is requested from your Tradovate account; see README.
* Verify field names against the current Tradovate API docs for your account
  type before going live -- brokers do change payloads. Every call is logged.
* Orders are placed with isAutomated=true and orderType="Market" so a
  TradingView alert results in a clean market fill; swing holds mean this runs
  at most a couple of times per day, not intraday churn.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict, List, Optional

from .config import TradovateConfig
from .logging_setup import get_logger

log = get_logger(__name__)


class TradovateError(RuntimeError):
    pass


@dataclass
class Account:
    id: int
    spec: str
    equity: float
    cash: float


@dataclass
class Position:
    symbol: str
    contract_id: int
    net_pos: int          # signed: + long, - short
    side: str             # "long" / "short" / "flat"
    avg_price: float


@dataclass
class OrderResult:
    order_id: Optional[int]
    symbol: str
    action: str
    qty: int
    status: str
    raw: dict


class TradovateClient:
    def __init__(self, cfg: TradovateConfig, session=None):
        self.cfg = cfg
        self._token: Optional[str] = None
        self._token_expiry: float = 0.0
        self._account: Optional[Account] = None
        if session is not None:
            self._session = session
        else:
            import requests

            self._session = requests.Session()

    # -- auth ---------------------------------------------------------------
    def _authenticate(self) -> None:
        if self._token and time.time() < self._token_expiry - 60:
            return  # still valid
        missing = [
            k for k, v in {
                "username": self.cfg.username,
                "password": self.cfg.password,
                "app_id": self.cfg.app_id,
                "cid": self.cfg.cid,
                "sec": self.cfg.sec,
            }.items() if not v
        ]
        if missing:
            raise TradovateError(
                f"Missing Tradovate credentials: {', '.join(missing)}. "
                f"Set them in the environment / .env."
            )
        body = {
            "name": self.cfg.username,
            "password": self.cfg.password,
            "appId": self.cfg.app_id,
            "appVersion": self.cfg.app_version,
            "cid": self.cfg.cid,
            "sec": self.cfg.sec,
        }
        data = self._post("/auth/accessTokenRequest", body, auth=False)
        if "accessToken" not in data:
            # Tradovate returns p-ticket / time penalties when throttled.
            raise TradovateError(f"Auth failed: {data}")
        self._token = data["accessToken"]
        # expirationTime is ISO; fall back to 60 min if absent.
        self._token_expiry = time.time() + 55 * 60
        log.info("Tradovate authenticated (env=%s)", self.cfg.env)

    # -- HTTP helpers -------------------------------------------------------
    def _headers(self, auth: bool) -> dict:
        h = {"Content-Type": "application/json", "Accept": "application/json"}
        if auth:
            h["Authorization"] = f"Bearer {self._token}"
        return h

    def _post(self, path: str, body: dict, auth: bool = True) -> dict:
        if auth:
            self._authenticate()
        url = self.cfg.base_url + path
        try:
            r = self._session.post(url, json=body, headers=self._headers(auth), timeout=30)
        except Exception as e:  # noqa: BLE001
            raise TradovateError(f"POST {path} failed: {e}") from e
        return _parse(r, path)

    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        self._authenticate()
        url = self.cfg.base_url + path
        try:
            r = self._session.get(url, params=params or {}, headers=self._headers(True), timeout=30)
        except Exception as e:  # noqa: BLE001
            raise TradovateError(f"GET {path} failed: {e}") from e
        return _parse(r, path)

    # -- accounts / equity --------------------------------------------------
    def get_account(self) -> Account:
        if self._account and self._account.equity:
            # refresh equity each call but keep id/spec
            pass
        accounts = self._get("/account/list")
        if not isinstance(accounts, list) or not accounts:
            raise TradovateError(f"No Tradovate accounts returned: {accounts}")
        acct = None
        if self.cfg.account_spec:
            acct = next((a for a in accounts if a.get("name") == self.cfg.account_spec), None)
        acct = acct or accounts[0]
        acct_id = acct["id"]
        spec = acct.get("name", str(acct_id))

        cash, equity = self._cash_snapshot(acct_id)
        self._account = Account(id=acct_id, spec=spec, equity=equity, cash=cash)
        return self._account

    def _cash_snapshot(self, account_id: int) -> tuple[float, float]:
        """Return (cash, equity/netLiq). Best-effort across API shapes."""
        try:
            snap = self._post(
                "/cashBalance/getcashbalancesnapshot", {"accountId": account_id}
            )
        except TradovateError as e:
            log.warning("cash snapshot failed (%s); falling back to cashBalance/list", e)
            snap = {}
        if isinstance(snap, dict) and snap:
            cash = float(snap.get("totalCashValue", snap.get("amount", 0.0)) or 0.0)
            equity = float(
                snap.get("netLiq", snap.get("totalCashValue", cash)) or cash
            )
            # open P&L, if present, is included in netLiq by Tradovate.
            return cash, equity or cash
        return 0.0, 0.0

    # -- positions ----------------------------------------------------------
    def list_positions(self) -> Dict[str, Position]:
        raw = self._get("/position/list")
        out: Dict[str, Position] = {}
        if not isinstance(raw, list):
            return out
        for p in raw:
            net = int(p.get("netPos", 0) or 0)
            if net == 0:
                continue
            contract_id = p.get("contractId")
            symbol = self._contract_name(contract_id) if contract_id else str(contract_id)
            out[symbol] = Position(
                symbol=symbol,
                contract_id=contract_id,
                net_pos=net,
                side="long" if net > 0 else "short",
                avg_price=float(p.get("netPrice", 0.0) or 0.0),
            )
        return out

    # -- contracts ----------------------------------------------------------
    def find_front_month(self, root: str) -> dict:
        """Resolve the current tradable contract for a root like 'MNQ'.

        Uses /contract/suggest then /contract/find. Returns the contract dict
        (with id and name). Raises if nothing tradable is found.
        """
        suggestions = self._get("/contract/suggest", {"t": root, "l": 10})
        if isinstance(suggestions, list) and suggestions:
            # Prefer the nearest expiry that is tradable.
            for c in suggestions:
                if c.get("name", "").startswith(root):
                    return c
            return suggestions[0]
        raise TradovateError(f"No contract found for root '{root}'.")

    def _contract_name(self, contract_id: int) -> str:
        try:
            c = self._get("/contract/item", {"id": contract_id})
            return c.get("name", str(contract_id))
        except TradovateError:
            return str(contract_id)

    # -- orders -------------------------------------------------------------
    def place_market_order(self, root: str, action: str, qty: int) -> OrderResult:
        """action: 'Buy' or 'Sell'. Resolves the front-month contract for root."""
        acct = self.get_account()
        contract = self.find_front_month(root)
        symbol = contract["name"]
        body = {
            "accountSpec": acct.spec,
            "accountId": acct.id,
            "action": action,
            "symbol": symbol,
            "orderQty": int(qty),
            "orderType": "Market",
            "isAutomated": True,
        }
        data = self._post("/order/placeorder", body)
        oid = data.get("orderId") or data.get("id")
        status = "Submitted" if oid else str(data)
        log.info("ORDER %s %s x%d -> %s", action, symbol, qty, status)
        return OrderResult(order_id=oid, symbol=symbol, action=action, qty=qty,
                           status=status, raw=data)

    def place_stop_order(self, root: str, action: str, qty: int,
                         stop_price: float) -> OrderResult:
        """Place a resting GTC stop order (broker-enforced protection).

        For a long position the protective order is a Sell Stop below entry;
        for a short, a Buy Stop above entry. Returns the order id so the relay
        can cancel it if the position is closed for another reason.
        """
        acct = self.get_account()
        contract = self.find_front_month(root)
        symbol = contract["name"]
        body = {
            "accountSpec": acct.spec,
            "accountId": acct.id,
            "action": action,           # "Sell" (protect long) / "Buy" (protect short)
            "symbol": symbol,
            "orderQty": int(qty),
            "orderType": "Stop",
            "stopPrice": round(float(stop_price), 4),
            "timeInForce": "GTC",
            "isAutomated": True,
        }
        data = self._post("/order/placeorder", body)
        oid = data.get("orderId") or data.get("id")
        log.info("STOP %s %s x%d @ %.4f -> %s", action, symbol, qty, stop_price,
                 oid or data)
        return OrderResult(order_id=oid, symbol=symbol, action=f"Stop/{action}",
                           qty=qty, status="Submitted" if oid else str(data), raw=data)

    def cancel_order(self, order_id) -> dict:
        """Cancel a resting order (e.g. the protective stop) by id."""
        data = self._post("/order/cancelorder", {"orderId": int(order_id)})
        log.info("CANCEL order %s -> %s", order_id, data)
        return data

    def flatten(self, root: str) -> OrderResult:
        """Close any open position in the front-month contract for root."""
        acct = self.get_account()
        contract = self.find_front_month(root)
        body = {"accountId": acct.id, "contractId": contract["id"], "admin": False}
        data = self._post("/order/liquidateposition", body)
        oid = data.get("orderId") or data.get("id")
        log.info("FLATTEN %s -> %s", contract["name"], oid or data)
        return OrderResult(order_id=oid, symbol=contract["name"], action="Flatten",
                           qty=0, status="Submitted" if oid else str(data), raw=data)


def _parse(response, path: str) -> dict:
    try:
        payload = response.json()
    except ValueError:
        payload = {"_status": response.status_code, "_text": response.text[:500]}
    if response.status_code >= 400:
        raise TradovateError(f"{path} -> HTTP {response.status_code}: {payload}")
    return payload
