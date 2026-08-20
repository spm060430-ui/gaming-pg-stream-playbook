#!/usr/bin/env python3
"""Start the webhook relay server.

  python run_relay.py

Reads config from env/.env. In dry-run mode (RELAY_DRY_RUN=true, the default)
it computes and logs every decision but places NO live orders -- use this to
validate the TradingView -> relay wiring safely. Flip RELAY_DRY_RUN=false and
set TRADOVATE_ENV=demo to route to the Tradovate DEMO account; only set
TRADOVATE_ENV=live after a long, successful demo run.
"""
from __future__ import annotations

from swingbot.config import load_config
from swingbot.logging_setup import get_logger, setup_logging

log = get_logger(__name__)


def main() -> None:
    cfg = load_config()
    setup_logging(cfg.log_dir)

    if not cfg.relay.webhook_secret:
        log.error("WEBHOOK_SECRET is not set. The relay refuses all alerts without it. "
                  "Set WEBHOOK_SECRET in your environment/.env and restart.")
    log.info("Starting relay: env=%s dry_run=%s watchlist=%s",
             cfg.tradovate.env, cfg.relay.dry_run, cfg.watchlist)

    try:
        import uvicorn
    except ImportError:
        raise SystemExit("uvicorn not installed. `pip install fastapi uvicorn`.")

    from swingbot.relay.server import create_app

    app = create_app(cfg)
    uvicorn.run(app, host=cfg.relay.host, port=cfg.relay.port, log_level="info")


if __name__ == "__main__":
    main()
