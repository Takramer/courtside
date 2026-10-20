// Phase 8: what the model said, against what happened.
//
// A projections table you never grade is a horoscope. Everything else in this engine is a
// claim — 63% to win the week, 1,420 points give or take 150 — and none of those claims
// means anything until they are written down before the games and checked after.
//
// Two things get graded, and they are not equally ready.
//
// The points projection can be graded from the first week: every week gives one predicted
// total and one actual total, so bias, average error and whether the spread is honest all
// start answering immediately. The win probability cannot. A single 63% that ends in a loss
// says nothing at all; you need tens of weeks before "63%" can be checked against how often
// those weeks were won. So the page leads with points and says plainly when the probability
// sample is still too thin to read. Being early is not the same as being wrong, and a page
// that blurs the two would be the dishonest kind of dashboard.

/** Was this snapshot taken before any of the week's games? Only those grade the full claim. */
export const isFullWeek = (e) => (e?.daysLeft ?? 0) >= 7

/**
 * Write the week's forecast down, once.
 *
 * Never overwritten, because the whole point is what the model said *before* it knew. If
 * you open the app again on Thursday the number will have moved — it should have, four
 * nights of basketball happened — but Monday's claim is the one being graded.
 */
export function recordWeek(ledger, entry) {
  const key = String(entry.week)
  if (!entry.week || ledger[key]) return ledger
  return { ...ledger, [key]: { ...entry, saved: entry.saved ?? new Date().toISOString() } }
}

/**
 * Attach what actually happened. `finals` is what ESPN says each completed week ended at:
 * [{ week, my, opp }]. Settling is idempotent and never touches the forecast.
 */
export function settle(ledger, finals = []) {
  const out = { ...ledger }
  for (const f of finals) {
    const key = String(f.week)
    const e = out[key]
    if (!e || f.my == null || f.opp == null) continue
    out[key] = { ...e, final: { my: f.my, opp: f.opp, won: f.my > f.opp, tie: f.my === f.opp } }
  }
  return out
}

/** Mean of a list, or null when there is nothing to average. */
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/**
 * The scorecard.
 *
 * Brier score is the mean squared error of the probabilities: 0 is perfect, and 0.25 is
 * what you get by saying 50% every week without looking. Beating 0.25 is the bar — a model
 * that cannot is worse than a coin and should be switched off, which is the outcome this
 * page exists to be able to report.
 *
 * `buckets` groups forecasts by confidence so you can see *where* it is wrong: a model that
 * is right at 55% and badly over-confident at 80% needs a different fix from one that is
 * uniformly off.
 */
export function score(ledger, { minForProbability = 20 } = {}) {
  const all = Object.values(ledger || {})
  const done = all.filter((e) => e.final && !e.final.tie).sort((a, b) => a.week - b.week)
  const full = done.filter(isFullWeek)

  // ---- points: gradeable from week one
  // Both teams, because his total was projected by the same engine and the win probability
  // rests on it as much as on mine. Twice the sample for nothing.
  const sides = done.flatMap((e) => [
    { mu: e.myMu, sd: e.mySd, got: e.final.my },
    ...(e.oppMu != null ? [{ mu: e.oppMu, sd: e.oppSd, got: e.final.opp }] : []),
  ])
  const errors = sides.map((x) => x.got - x.mu) // signed: + means it scored more than we said
  const spread = sides.filter((x) => x.sd > 0)
  const inBand = spread.filter((x) => Math.abs(x.got - x.mu) <= x.sd)
  const points = sides.length ? {
    n: sides.length,
    // Positive bias means the projection runs low. A persistent one is the easiest thing
    // here to fix and the most embarrassing to leave in.
    bias: +mean(errors).toFixed(1),
    mae: +mean(errors.map(Math.abs)).toFixed(1),
    // The spread claims about 68% of weeks land within one standard deviation. Far under
    // and the model is overconfident; far over and it is hedging.
    within1sd: spread.length ? +(inBand.length / spread.length).toFixed(3) : null,
    expected1sd: 0.68,
    // The same question as one number: the mean squared miss in units of the claimed spread.
    // An honest spread scores 1. Above 1 and the misses are bigger than the model admits.
    z2: spread.length ? +mean(spread.map((x) => ((x.got - x.mu) / x.sd) ** 2)).toFixed(3) : null,
  } : null

  // ---- the margin: the one number the win probability actually depends on
  // P(win) is the chance the margin lands above zero, so its spread is what has to be honest.
  // Measured on the margin rather than on each side, because the two sides of one week are
  // not independent of each other — same nights, same league-wide slumps.
  const margins = done.filter((e) => e.oppMu != null && e.mySd > 0 && e.oppSd > 0).map((e) =>
    ((e.final.my - e.final.opp) - (e.myMu - e.oppMu)) ** 2 / (e.mySd ** 2 + e.oppSd ** 2))
  const margin = margins.length ? { n: margins.length, z2: +mean(margins).toFixed(3) } : null

  // ---- win probability: needs a season before it says anything
  const brier = done.length ? +mean(done.map((e) => (e.pWin - (e.final.won ? 1 : 0)) ** 2)).toFixed(4) : null
  // Symmetric, so over-confidence shows at both ends: the replay put four in ten of its
  // matchups below 40%, and one bucket for all of them hid that they were won too often.
  const edges = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0001]
  const buckets = []
  for (let i = 0; i < edges.length - 1; i++) {
    const inB = done.filter((e) => e.pWin >= edges[i] && e.pWin < edges[i + 1])
    if (!inB.length) continue
    buckets.push({
      from: edges[i],
      to: Math.min(1, edges[i + 1]),
      n: inB.length,
      said: +mean(inB.map((e) => e.pWin)).toFixed(3),
      actual: +(inB.filter((e) => e.final.won).length / inB.length).toFixed(3),
    })
  }

  return {
    weeks: all.length,
    graded: done.length,
    fullWeek: full.length,
    pending: all.filter((e) => !e.final).length,
    points,
    margin,
    brier,
    baseline: 0.25, // saying 50% every week, without looking at anything
    beatsCoin: brier == null ? null : brier < 0.25,
    buckets,
    // Below this the probability numbers are shown but must not be read as a verdict.
    enoughForProbability: done.length >= minForProbability,
    minForProbability,
    record: { won: done.filter((e) => e.final.won).length, lost: done.filter((e) => !e.final.won).length },
  }
}

/**
 * How much to widen the live spread, from everything graded so far.
 *
 * The replay of last season is the prior: thousands of weeks, but a season ago and on
 * rosters that were never real. The ledger is the evidence: your league, this season, but a
 * handful of weeks. Each margin's squared miss counts once, the replay counts as `weight` of
 * them, and the answer moves from the replay to the ledger as the season fills in. With
 * neither, 1 — the raw model, untouched.
 *
 * Clipped, because a scale is a correction, not a rescue. If the spread were off by more
 * than this the model would be broken in a way widening cannot fix, and the scorecard is
 * where that should show.
 */
export function spreadScale({ replay, ledger, weight = 40, lo = 0.8, hi = 1.6 } = {}) {
  const prior = replay?.z2 ?? 1
  const n = ledger?.n ?? 0
  const z2 = (n * (ledger?.z2 ?? 0) + weight * prior) / (n + weight)
  return +Math.min(hi, Math.max(lo, Math.sqrt(z2))).toFixed(3)
}
