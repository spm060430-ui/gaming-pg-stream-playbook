# 👋 When you're back — your checklist

You've already done the hard parts! Here's exactly where we are and what's left.
Nothing here has cost money or placed any real trade — it's all been safe practice.

---

## ✅ What you've already finished
- [x] Installed Python
- [x] Downloaded the robot's files
- [x] Ran a practice backtest on your computer (saw the results + the graph)
- [x] Put the robot's "brain" onto a live gold chart in TradingView
- [x] Started the robot's server and confirmed it's alive

## ⬜ What's left (about 15 minutes, with Claude guiding you)
- [ ] **Step A — Prove the server reacts** (free, 2 min): double-click the two
      helper files (below).
- [ ] **Step B — Get a paid TradingView plan** (~$15/mo): only needed for the
      auto-ping feature. This is the one part that costs money.
- [ ] **Step C — Make the robot reachable from the internet** (free tool): so
      TradingView can talk to it. Claude will walk you through it.
- [ ] **Step D — Create the TradingView alert** that pings the robot.
- [ ] **Step E — Watch it run in dry-run** (pretend money) for a while.
- [ ] Later: switch to **Tradovate demo** (still fake money) for 4–6 weeks
      before you ever consider real money.

> Do NOT skip to real money. The plan is: dry-run → Tradovate demo (weeks) →
> only then a deliberate decision about real funds. And remember the account-size
> math in README.md — these instruments really want a large account to be safe.

---

## 🖱️ The two double-click helpers I made you

You no longer need to type in the black window. In the `tv_tradovate_bot` folder:

1. **`START_ROBOT.bat`** — double-click it. A window opens and the robot's server
   starts in safe pretend mode. **Leave that window open.** Check it worked by
   opening **http://localhost:8000/health** in your browser.

2. **`SEND_TEST_SIGNAL.bat`** — double-click it (while the robot is running) to
   send a fake "buy gold" signal and watch the robot react. Pure pretend.

To stop the robot: just close its window.

---

## 💬 When you're ready
Come back to this chat and say **"I'm back, let's keep going"** — we'll pick up at
Step A or B, one baby step at a time. No rush, nothing's at risk. 🙂
