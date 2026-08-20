"""FastAPI webhook relay.

Receives TradingView alert webhooks and hands them to the decision engine.
This is a thin transport layer -- all trading logic lives in swingbot/engine.py.

Endpoints
---------
  GET  /health   -> liveness + config summary (secrets redacted)
  GET  /state    -> current positions / halt status
  POST /webhook  -> process a TradingView alert

Run with:  python run_relay.py   (or: uvicorn swingbot.relay.server:app)

Security: the endpoint is PUBLIC (TradingView must reach it). Every alert must
carry the exact shared secret (WEBHOOK_SECRET); anything else is rejected with
401/400. Put it behind HTTPS (a reverse proxy or a tunnel) in production.

NOTE: deliberately NO `from __future__ import annotations` here -- FastAPI needs
the real `Request` class object as the handler annotation, not a stringized name
it would try (and fail) to resolve against this module's globals.
"""
import json
from typing import Optional

from ..config import Config, load_config
from ..engine import AlertRejected, process_alert
from ..logging_setup import get_logger, setup_logging
from ..state import load_state

log = get_logger(__name__)


def create_app(cfg: Optional[Config] = None, broker=None):
    try:
        from fastapi import FastAPI, Request
        from fastapi.responses import JSONResponse
    except ImportError as e:  # pragma: no cover
        raise RuntimeError("fastapi/uvicorn not installed. `pip install fastapi uvicorn`.") from e

    cfg = cfg or load_config()
    setup_logging(cfg.log_dir)

    # Lazily build a real Tradovate client unless one is injected or we're in
    # pure dry-run without credentials.
    if broker is None and not cfg.relay.dry_run:
        from ..tradovate import TradovateClient

        broker = TradovateClient(cfg.tradovate)
    _broker = broker

    app = FastAPI(title="swingbot relay", version="0.1.0")

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "env": cfg.tradovate.env,
            "dry_run": cfg.relay.dry_run,
            "watchlist": cfg.watchlist,
        }

    @app.get("/state")
    def state():
        s = load_state(cfg.state_file)
        return {
            "halted": s.halted,
            "halt_reason": s.halt_reason,
            "positions": {k: v.__dict__ for k, v in s.positions.items()},
            "day_start_equity": s.day_start_equity,
            "week_start_equity": s.week_start_equity,
            "last_run": s.last_run,
        }

    @app.post("/webhook")
    async def webhook(request: Request):
        # TradingView sends text/plain by default; parse JSON ourselves.
        raw = await request.body()
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001
            return JSONResponse(status_code=400, content={"error": "invalid JSON body"})
        try:
            result = process_alert(payload, cfg, _broker)
        except AlertRejected as e:
            log.warning("Rejected alert: %s", e)
            return JSONResponse(status_code=401, content={"error": str(e)})
        except Exception as e:  # noqa: BLE001 -- engine already halted+alerted
            log.error("Relay error: %s", e)
            return JSONResponse(status_code=500, content={"error": "internal error; bot halted"})
        return {
            "accepted": result.accepted,
            "action_taken": result.action_taken,
            "detail": result.detail,
            "order_id": result.order_id,
        }

    return app


# Module-level app for `uvicorn swingbot.relay.server:app`.
app = None
try:  # pragma: no cover - only builds if fastapi present
    app = create_app()
except Exception as _e:  # noqa: BLE001
    log.debug("Deferred app creation: %s", _e)
