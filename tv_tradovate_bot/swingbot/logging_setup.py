"""Logging configuration.

Every decision and trade flows through the standard `logging` module so we get
consistent, timestamped, greppable records on the console and in a rotating
file. Modules get their logger via `get_logger(__name__)`.
"""
from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler

_CONFIGURED = False


def setup_logging(log_dir: str = "logs", level: int = logging.INFO) -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    os.makedirs(log_dir, exist_ok=True)
    fmt = logging.Formatter(
        "%(asctime)s %(levelname)-8s %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    root = logging.getLogger()
    root.setLevel(level)

    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    root.addHandler(ch)

    fh = RotatingFileHandler(
        os.path.join(log_dir, "swingbot.log"), maxBytes=2_000_000, backupCount=5
    )
    fh.setFormatter(fmt)
    root.addHandler(fh)
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
