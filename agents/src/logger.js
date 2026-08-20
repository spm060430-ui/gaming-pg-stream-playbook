// Minimal structured logger. Prints compact, numbers-first lines to stdout and
// keeps an in-memory event array the reporter can summarize. Every rejected
// action is logged loudly — a silent guardrail is a useless one.

const TAG = {
  trading: "\x1b[36mTRADE\x1b[0m",
  betting: "\x1b[35mBOOK \x1b[0m",
  commander: "\x1b[33mCMDR \x1b[0m",
  system: "\x1b[90mSYS  \x1b[0m",
};

export class Logger {
  constructor({ quiet = false } = {}) {
    this.quiet = quiet;
    this.events = [];
    this.tick = 0;
  }

  setTick(t) {
    this.tick = t;
  }

  event(desk, kind, data = {}) {
    const rec = { tick: this.tick, desk, kind, ...data };
    this.events.push(rec);
    if (!this.quiet) console.log(this.format(rec));
    return rec;
  }

  // A rejected action — always visible, with the engine's code and reason.
  reject(desk, action, check) {
    return this.event(desk, "REJECT", {
      code: check.code,
      reason: check.reason,
      proposed: compact(action),
    });
  }

  format(rec) {
    const tag = TAG[rec.desk] || TAG.system;
    const rest = Object.entries(rec)
      .filter(([k]) => !["tick", "desk", "kind"].includes(k))
      .map(([k, v]) => `${k}=${fmt(v)}`)
      .join(" ");
    const kind = rec.kind === "REJECT" ? "\x1b[31mREJECT\x1b[0m" : rec.kind;
    return `[t${String(rec.tick).padStart(2, "0")}] ${tag} ${kind.padEnd(8)} ${rest}`;
  }
}

function fmt(v) {
  if (v && typeof v === "object") return JSON.stringify(v);
  return v;
}
function compact(action) {
  const { signal, edgeNote, reason, ...rest } = action || {};
  return rest;
}
