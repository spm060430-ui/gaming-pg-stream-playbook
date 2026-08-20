// Formats the Commander's end-of-day and final summaries. Numbers-first,
// anomalies (freezes, rejections) surfaced at the top — per the prompt pack.

import { round } from "./ledger.js";

export function summary(title, { ledger, trading, betting, logger }) {
  const snap = ledger.snapshot();
  const rejects = logger.events.filter((e) => e.kind === "REJECT");
  const freezes = logger.events.filter((e) => e.kind === "FREEZE" || e.kind === "ESCALATE");

  const lines = [];
  lines.push("");
  lines.push(`══ ${title} ══`);

  if (freezes.length) {
    lines.push(`⚠ ANOMALIES: ${freezes.length} freeze/escalation event(s)`);
    for (const f of freezes) lines.push(`   • t${f.tick} ${f.kind} ${f.code || ""} ${f.reason || ""}`.trimEnd());
  }
  if (rejects.length) {
    const byCode = tally(rejects.map((r) => r.code));
    lines.push(`⚠ Guardrail rejections: ${rejects.length} — ${fmtTally(byCode)}`);
  }
  if (!freezes.length && !rejects.length) lines.push("✓ No anomalies.");

  const pl = round(snap.bankroll - snap.startingBankroll);
  const plPct = ((pl / snap.startingBankroll) * 100).toFixed(2);
  lines.push("");
  lines.push(`Bankroll     ${snap.startingBankroll} → ${snap.bankroll}   (P&L ${signed(pl)}, ${signed(plPct)}%)`);
  lines.push(`Reserved     trading=${snap.reserved.trading}  betting=${snap.reserved.betting}  reserve=${snap.reserve}`);
  lines.push(`Exposure     trading=${snap.exposure.trading}  betting=${snap.exposure.betting}  total=${snap.totalExposure}`);
  lines.push(`Frozen       trading=${snap.frozen.trading}  betting=${snap.frozen.betting}`);
  lines.push("");
  lines.push(`Futures Desk realizedPnl=${signed(trading.realizedPnl)}  openPositions=${trading.openPositions}`);
  lines.push(`Book Desk    realizedPnl=${signed(betting.realizedPnl)}  betsSettled=${betting.settled}  avgClvEdge=${betting.avgClvEdge}`);
  lines.push("");
  return lines.join("\n");
}

function tally(arr) {
  const m = {};
  for (const x of arr) m[x] = (m[x] || 0) + 1;
  return m;
}
function fmtTally(m) {
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}×${v}`)
    .join(", ");
}
function signed(n) {
  const num = Number(n);
  return num > 0 ? `+${n}` : `${n}`;
}
