// Guardrail tests. These prove the risk engine rejects out-of-limit actions
// no matter what an agent proposes — the property the whole design rests on.
// Plain Node, no framework: `node test/riskEngine.test.js`.

import assert from "node:assert/strict";
import { config as baseConfig } from "../config.js";
import { Ledger } from "../src/ledger.js";
import { RiskEngine, DAY_MS } from "../src/riskEngine.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

// Fresh engine per test so state never leaks between cases.
function setup() {
  const config = structuredClone(baseConfig);
  const ledger = new Ledger(config);
  const risk = new RiskEngine(config, ledger);
  return { config, ledger, risk };
}

const goodTrade = () => ({
  instrument: "GOLD",
  direction: "long",
  notional: 500,
  entry: 100,
  stop: 98,
  markPrice: 100,
});
const goodBet = () => ({ league: "NFL", betType: "moneyline", odds: 2.0, modelProb: 0.6, stake: 20 });

console.log("Trading guardrails:");

test("accepts an in-limit trade", () => {
  const { risk } = setup();
  assert.equal(risk.validateTradeOpen(goodTrade(), { positions: [] }).ok, true);
});

test("rejects an instrument outside scope", () => {
  const { risk } = setup();
  const r = risk.validateTradeOpen({ ...goodTrade(), instrument: "BTC" }, { positions: [] });
  assert.equal(r.code, "BAD_INSTRUMENT");
});

test("rejects a position with no stop", () => {
  const { risk } = setup();
  const a = goodTrade();
  delete a.stop;
  assert.equal(risk.validateTradeOpen(a, { positions: [] }).code, "NO_STOP");
});

test("rejects a stop on the wrong side of entry", () => {
  const { risk } = setup();
  assert.equal(risk.validateTradeOpen({ ...goodTrade(), stop: 102 }, { positions: [] }).code, "BAD_STOP");
});

test("rejects a stop wider than the max distance", () => {
  const { risk } = setup();
  assert.equal(risk.validateTradeOpen({ ...goodTrade(), stop: 90 }, { positions: [] }).code, "STOP_TOO_WIDE");
});

test("rejects an oversize position", () => {
  const { risk, ledger } = setup();
  // cap = 25% of 4000 = 1000
  const r = risk.validateTradeOpen({ ...goodTrade(), notional: 1500 }, { positions: [] });
  assert.equal(r.code, "SIZE_CAP");
  assert.equal(ledger.reserved.trading, 4000);
});

test("rejects exceeding max concurrent positions", () => {
  const { risk } = setup();
  const positions = [1, 2, 3].map((i) => ({ id: `T${i}`, instrument: "SP500", direction: "long", notional: 100, entry: 100, stop: 99 }));
  assert.equal(risk.validateTradeOpen(goodTrade(), { positions }).code, "MAX_POSITIONS");
});

test("rejects averaging down on a loser", () => {
  const { risk } = setup();
  const positions = [{ id: "T1", instrument: "GOLD", direction: "long", notional: 100, entry: 110, stop: 105 }];
  // markPrice 100 < entry 110 => existing long is losing
  assert.equal(risk.validateTradeOpen(goodTrade(), { positions }).code, "AVERAGING_DOWN");
});

test("rejects new positions inside the open buffer", () => {
  const { risk } = setup();
  const r = risk.validateTradeOpen({ ...goodTrade(), minutesFromOpen: 2 }, { positions: [] });
  assert.equal(r.code, "SESSION_OPEN");
});

test("rejects trading once the daily loss limit is hit", () => {
  const { risk, ledger } = setup();
  ledger.recordPnl("trading", -0.03 * 4000); // exactly the 3% daily limit
  assert.equal(risk.validateTradeOpen(goodTrade(), { positions: [] }).code, "DAILY_LOSS");
});

console.log("\nBetting guardrails:");

test("accepts an in-limit, positive-edge bet", () => {
  const { risk } = setup();
  assert.equal(risk.validateBet(goodBet(), { recentStakes: [] }).ok, true);
});

test("rejects a league outside scope", () => {
  const { risk } = setup();
  assert.equal(risk.validateBet({ ...goodBet(), league: "KHL" }, { recentStakes: [] }).code, "BAD_LEAGUE");
});

test("rejects a bet below the edge threshold", () => {
  const { risk } = setup();
  // odds 2.0 => implied 0.5; modelProb 0.51 => edge 1% < 3% min
  assert.equal(risk.validateBet({ ...goodBet(), modelProb: 0.51 }, { recentStakes: [] }).code, "NO_EDGE");
});

test("rejects a stake over the single-bet cap", () => {
  const { risk } = setup();
  // cap = 2% of 2000 = 40
  assert.equal(risk.validateBet({ ...goodBet(), stake: 100 }, { recentStakes: [] }).code, "STAKE_CAP");
});

test("rejects chasing after a losing day", () => {
  const { risk, ledger } = setup();
  ledger.recordPnl("betting", -50); // down on the day
  // recent avg stake 10; proposing 30 (still under cap 40) => chasing
  assert.equal(risk.validateBet({ ...goodBet(), stake: 30 }, { recentStakes: [10, 10] }).code, "CHASING");
});

test("rejects betting once the daily loss limit is hit", () => {
  const { risk, ledger } = setup();
  ledger.recordPnl("betting", -0.05 * 2000); // 5% daily limit
  assert.equal(risk.validateBet(goodBet(), { recentStakes: [] }).code, "DAILY_LOSS");
});

console.log("\nPortfolio guardrails:");

test("kill switch trips on a 24h loss breach", () => {
  const { risk, ledger } = setup();
  ledger.now = DAY_MS;
  ledger.pnlHistory.push({ ts: DAY_MS, desk: "trading", amount: -0.07 * 10000 }); // >6%
  assert.equal(risk.checkKillSwitch().code, "KILL_24H");
});

test("kill switch stays clear below the threshold", () => {
  const { risk, ledger } = setup();
  ledger.now = DAY_MS;
  ledger.pnlHistory.push({ ts: DAY_MS, desk: "trading", amount: -0.05 * 10000 }); // <6%
  assert.equal(risk.checkKillSwitch().ok, true);
});

test("combined exposure cap blocks over-allocation", () => {
  const { risk, ledger } = setup();
  ledger.setExposure("trading", 4000);
  ledger.setExposure("betting", 900);
  // cap = 50% of 10000 = 5000; adding 200 => 5100 > cap
  assert.equal(risk.checkCombinedExposure(200).code, "EXPOSURE_CAP");
});

console.log(`\n${passed} checks passed.`);
