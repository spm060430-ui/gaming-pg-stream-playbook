"""Alerting.

Two channels: logging (always on) and optional email (SMTP) for halts, fatal
errors and daily reports. `alert()` never raises -- a broken mailer must not
mask the original problem, and the spec requires halt-and-alert, never silent
failure.
"""
from __future__ import annotations

import smtplib
from email.mime.text import MIMEText

from .config import NotifyConfig
from .logging_setup import get_logger

log = get_logger(__name__)


def alert(cfg: NotifyConfig, subject: str, body: str, level: str = "warning") -> None:
    getattr(log, level, log.warning)("ALERT: %s\n%s", subject, body)
    if not cfg.enabled:
        return
    if not (cfg.smtp_host and cfg.email_from and cfg.email_to):
        log.warning("Email enabled but SMTP settings incomplete; skipping email.")
        return
    try:
        msg = MIMEText(body)
        msg["Subject"] = f"[swingbot] {subject}"
        msg["From"] = cfg.email_from
        msg["To"] = cfg.email_to
        with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=20) as server:
            server.starttls()
            if cfg.smtp_user and cfg.smtp_password:
                server.login(cfg.smtp_user, cfg.smtp_password)
            server.sendmail(cfg.email_from, [cfg.email_to], msg.as_string())
        log.info("Alert email sent to %s", cfg.email_to)
    except Exception as e:  # noqa: BLE001
        log.error("Failed to send alert email: %s", e)
