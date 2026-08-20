// A simulated sports-odds feed for the Book Desk. Each tick it offers a small
// slate of games with a book price (decimal odds, vig baked in) and a "true"
// win probability the sim knows but the agent does not. The agent's job is to
// estimate its own probability; the risk engine only lets a bet through when
// the agent's estimate implies an edge above config.betting.minEdge.
//
// This is the PAPER-MODE data source. In a live deployment you would replace
// it with a real odds API — AND you would first read the note in the README
// about sportsbook terms of service, which almost universally prohibit bots.

const TEAMS = {
  NFL: ["Chiefs", "Bills", "49ers", "Eagles", "Ravens", "Cowboys"],
  NBA: ["Celtics", "Nuggets", "Bucks", "Suns", "Heat", "Lakers"],
  MLB: ["Dodgers", "Braves", "Astros", "Yankees", "Orioles", "Rays"],
};

let counter = 0;

export class OddsFeed {
  constructor(leagues, betTypes) {
    this.leagues = leagues;
    this.betTypes = betTypes;
  }

  // Produce a slate of candidate bets for this tick.
  slate(n = 3) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const league = pick(this.leagues);
      const teams = TEAMS[league] || ["Home", "Away"];
      const home = pick(teams);
      let away = pick(teams);
      while (away === home) away = pick(teams);
      const betType = pick(this.betTypes);

      // The sim's hidden "true" probability for the selection.
      const trueProb = clamp(0.35 + Math.random() * 0.3, 0.05, 0.95);
      // The book's offered decimal odds carry a vig, so the implied prob sits
      // ABOVE the true prob on average — i.e. most bets have no real edge.
      const vig = 0.045;
      const impliedProb = clamp(trueProb + (Math.random() - 0.35) * 0.08 + vig, 0.05, 0.98);
      const odds = round2(1 / impliedProb);

      out.push({
        id: `g${counter++}`,
        league,
        betType,
        selection: `${home} ${labelFor(betType)}`,
        matchup: `${home} vs ${away}`,
        odds, // decimal odds shown to the agent
        impliedProb: round4(impliedProb), // = 1/odds, shown for convenience
        _trueProb: round4(trueProb), // hidden from the agent; used to settle
      });
    }
    return out;
  }

  // Settle a placed bet against the hidden true probability. Returns profit
  // (positive) or loss (= -stake) for a unit stake resolution.
  settle(bet) {
    const won = Math.random() < bet._trueProb;
    if (won) return round2(bet.stake * (bet.odds - 1));
    return round2(-bet.stake);
  }
}

function labelFor(betType) {
  if (betType === "moneyline") return "ML";
  if (betType === "spread") return "-3.5";
  return "Over";
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;
