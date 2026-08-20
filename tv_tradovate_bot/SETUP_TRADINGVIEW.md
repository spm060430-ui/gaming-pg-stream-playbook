# Testing on TradingView — step by step

This gets you from "code exists" to "a TradingView alert fires and the relay
reacts", **safely in dry-run** (no real orders). Do this whole guide before
touching Tradovate demo or live.

```
TradingView alert ──HTTPS webhook──▶ your relay (/webhook) ──▶ [dry-run: log only]
```

---

## 0. Prerequisites

- **A TradingView plan that supports webhook alerts.** Webhook notifications are
  a paid feature (Essential/Plus/Premium). The free plan can run the strategy in
  the Strategy Tester but **cannot send webhooks**.
- A place to run the relay that can expose a **public HTTPS URL**. Options below:
  a laptop + a tunnel (easiest for testing), or a small VPS.
- Docker installed (recommended) — or Python 3.11 + `pip`.

You do **not** need Tradovate credentials for this dry-run test.

---

## 1. Configure the relay

```bash
cd tv_tradovate_bot
cp .env.example .env
```

Edit `.env` and set at least:

```
WEBHOOK_SECRET=<a long random string>   # e.g. `openssl rand -hex 24`
RELAY_DRY_RUN=true                       # IMPORTANT: no orders placed
```

Leave the Tradovate fields blank for now. Keep `RELAY_DRY_RUN=true` until you've
watched it behave and are ready for Tradovate demo.

---

## 2. Start the relay + get a public URL

### Option A — Docker + built-in Cloudflare quick tunnel (easiest)

```bash
docker compose --profile tunnel up --build
```

- The **relay** starts on port 8000.
- The **tunnel** container prints a line like
  `https://random-words.trycloudflare.com` in its logs. That is your public URL.
  (Run `docker compose logs tunnel` if you miss it.)
- Your webhook URL for TradingView is that URL **+ `/webhook`**.

No Cloudflare account is needed for the quick tunnel. The URL changes each time
you restart — fine for testing.

### Option B — Python locally + ngrok

```bash
pip install -r requirements.txt
python run_relay.py            # serves on http://localhost:8000
# in another terminal:
ngrok http 8000               # prints an https://<id>.ngrok-free.app URL
```

Webhook URL = the ngrok https URL **+ `/webhook`**.

### Verify the relay is up

```bash
curl https://<your-public-url>/health
# {"status":"ok","env":"demo","dry_run":true,"watchlist":["MNQ","MGC"]}
```

---

## 3. Smoke-test the webhook (before TradingView)

Prove the whole path with a fake alert:

```bash
WEBHOOK_SECRET=<same as .env> ./scripts/smoke_webhook.sh https://<your-public-url>
```

You should see the good alert accepted (entered/blocked/skipped) and the
bad-secret alert return **HTTP 401**. Watch the relay logs — every decision is
printed. If this works, TradingView will too.

---

## 4. Add the strategy to a chart

1. Open a chart for the instrument. Use the **continuous** micro symbols:
   `MNQ1!` (Micro Nasdaq) or `MGC1!` (Micro Gold). Set the timeframe to **1D**
   (daily) for swing trading.
2. Open **Pine Editor** (bottom panel) → paste the contents of
   `pine/swing_strategy.pine` → **Add to chart**.
3. Open the strategy **Settings (⚙)** and set inputs:
   - **Webhook shared secret** = the exact `WEBHOOK_SECRET` from your `.env`.
   - **Symbol tag sent to relay** = `MNQ` on the MNQ chart, `MGC` on the MGC
     chart. (This tells the relay which contract the alert is for — it must be
     one of your `WATCHLIST` symbols.)
   - Leave EMA/RSI/ATR at defaults so they match the Python config.
4. Check the **Strategy Tester** tab to confirm it trades sensibly on history.

---

## 5. Create the alert (this is what sends the webhook)

1. Click **Alert (⏰)** → in the **Condition** dropdown, select the strategy
   **“Swing EMA+RSI (MNQ/MGC)”**.
2. In the **Message** box, put **exactly**:
   ```
   {{strategy.order.alert_message}}
   ```
   (The Pine builds the JSON per order; this placeholder delivers it.)
3. Open the **Notifications** tab → enable **Webhook URL** → paste
   `https://<your-public-url>/webhook`.
4. Set expiration to **Open-ended** and create the alert.
5. **Repeat for the second symbol**: one chart + one alert per symbol (MNQ and
   MGC each get their own).

> Note: strategy alerts fire when an order **fills** on a bar. On a daily chart
> that means at most once per day per symbol — exactly the swing cadence.

---

## 6. Watch it work

- When a golden/death cross fires, TradingView POSTs the JSON to your relay.
- In dry-run the relay logs a line like:
  `ALERT long_entry MGC -> entered ([dry-run] Buy 1x MGC; ...)`
  and records the position in `data/state.json` — but places **no order**.
- Tail the logs: `docker compose logs -f relay` (or the console for Option B).
- `curl https://<your-public-url>/state` shows tracked positions and halt status.

To force a quick end-to-end test without waiting for a real cross, you can
re-run the smoke script, or use TradingView’s alert **“Test”**-style manual
trigger by temporarily loosening the strategy inputs on a fast timeframe.

---

## 7. When you’re satisfied → Tradovate demo

Only after the dry-run path is solid:

1. Set in `.env`: `RELAY_DRY_RUN=false`, `TRADOVATE_ENV=demo`, and your Tradovate
   API credentials (`TRADOVATE_USERNAME/PASSWORD/APP_ID/CID/SECRET`).
2. Restart the relay. Now alerts place **demo** orders on Tradovate.
3. Run for **4–6 weeks**; compare `logs/reports/` to TradingView’s paper results.
4. Go live (`TRADOVATE_ENV=live`) only as a deliberate, separate decision — and
   re-read the account-size math in the main README first.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| TradingView: "webhook not available" | Your plan doesn’t include webhooks — upgrade, or test with the smoke script only. |
| Relay returns 401 | The `secret` in the alert ≠ `WEBHOOK_SECRET` in `.env`. |
| Relay returns 400 "symbol not in watchlist" | The Pine **Symbol tag** input isn’t `MNQ`/`MGC` (or isn’t in `WATCHLIST`). |
| Alert fires but relay logs nothing | Wrong webhook URL, missing `/webhook`, or the tunnel URL changed after a restart. |
| Entry "skipped: sizing" | Expected on a small account — see the account-size section in the README. |
| Duplicate alert ignored | Working as intended: each alert `id` is processed once. |
