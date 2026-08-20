#!/usr/bin/env bash
# Send test alerts to the relay to prove the wiring BEFORE connecting TradingView.
#
# Usage:
#   WEBHOOK_SECRET=your-secret ./scripts/smoke_webhook.sh [BASE_URL]
#
#   BASE_URL defaults to http://localhost:8000
#   Set WEBHOOK_SECRET to the same value as in your .env.
#
# In dry-run (RELAY_DRY_RUN=true) the relay computes + logs decisions but places
# NO orders -- watch the relay logs alongside this script.
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
SECRET="${WEBHOOK_SECRET:-}"

if [[ -z "$SECRET" ]]; then
  echo "ERROR: set WEBHOOK_SECRET to match your .env (export WEBHOOK_SECRET=...)" >&2
  exit 1
fi

echo "== health =="
curl -fsS "$BASE_URL/health" && echo

echo; echo "== good entry alert (should be accepted / entered or skipped-by-sizing) =="
curl -sS -X POST "$BASE_URL/webhook" \
  -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$SECRET\",\"id\":\"smoke-$(date +%s)\",\"action\":\"long_entry\",\"symbol\":\"MGC\",\"price\":2300.0,\"atr\":25.0,\"rsi\":55.0}"
echo

echo; echo "== bad secret (should be 401 rejected) =="
curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST "$BASE_URL/webhook" \
  -H 'Content-Type: application/json' \
  -d "{\"secret\":\"WRONG\",\"action\":\"long_entry\",\"symbol\":\"MGC\",\"price\":2300.0}"

echo; echo "== current relay state =="
curl -fsS "$BASE_URL/state" && echo
