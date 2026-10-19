// Phase 3 and 4: a projection per player per game, and the odds for the week.
//
// Two ideas do all the work here.
//
// A player-day is not a number, it is a coin flip and then a draw: he plays or he does not,
// and if he plays his score varies from night to night. Written out, that mixture has
//     mean      p * m
//     variance  p * (s^2 + m^2) - (p * m)^2
// which is where availability earns its place beside the average. A 40-point player who
// misses a third of the season is not worth 40.
//
// A week is forty-odd of those added up, and the sum of forty independent things is close
// enough to a bell curve to skip the simulation: P(I win) is the chance a normal with my
// mean and spread lands above one with his. That is instant, it is the same answer every
// time you look at it, and every number in it can be checked by hand — which a Monte Carlo
// with a random seed cannot. The cost is the assumption below.
//
// ASSUMPTION, stated once and not hidden: player-days are treated as independent. They are
// not quite. Teammates share a ball, and two players in the same real game share its pace.
// The error is small next to the spread of the players themselves, and it makes the result
// slightly overconfident in the tails. Phase 8 grades this against what actually happens.

// Abramowitz & Stegun 7.1.26. Accurate to about 1.5e-7, which is far past what this needs.
export function normalCdf(z) {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

// How much of this season's own games to trust over the prior. Mirrors blendLine in model.js:
// twelve games in, what has happened counts for half.
const formWeight = (games) => games / (games + 12)

const PRIOR_WEIGHT = 0.35 // last season's form against ESPN's projection for this one
const SD_IF_UNKNOWN = 0.45 // a typical game-to-game spread, as a share of the average

// A healthy player's chance of suiting up tonight, and how far last season's absences pull it.
// Last season's availability is weak evidence about this week: a player who missed half a
// season with a torn Achilles and is on the floor today is not 50% to play tomorrow. So the
// prior dominates and history only nudges it. Tatum at 0.195 availability lands near 0.68,
// not 0.20 — which is the difference between a projection and a grudge.
const AVAIL_PRIOR = 0.92
const AVAIL_PULL = 0.3

/**
 * One player's expected night: what he scores, how much that swings, and whether he suits up.
 *
 * espnFp  fantasy points per game from the app's own blend of ESPN projection and this season
 * form    his row from public/data/form.json, or undefined if the worker has not seen him
 * status  'ok' | 'dtd' | 'out' from the live injury report, which outranks any history
 * current whether form.json is this season (trust it by games played) or last (a prior)
 */
export function projectPlayer({ espnFp, form, status = 'ok', current = false }) {
  const base = espnFp ?? form?.fp_mean ?? 0
  let mean = base
  if (form?.fp_mean != null) {
    const w = current ? formWeight(form.g ?? 0) : PRIOR_WEIGHT
    mean = base * (1 - w) + form.fp_mean * w
  }
  const sd = form?.fp_sd ?? Math.abs(mean) * SD_IF_UNKNOWN
  // Out is out. Day-to-day is a coin flip, which is the honest reading of "game-time decision".
  // Otherwise fall back on how often he has actually been available.
  const pPlay = status === 'out' ? 0
    : status === 'dtd' ? 0.5
      : form?.avail != null ? +(AVAIL_PRIOR - AVAIL_PULL * (1 - form.avail)).toFixed(3)
        : AVAIL_PRIOR
  return { mean: +mean.toFixed(2), sd: +sd.toFixed(2), pPlay: +pPlay.toFixed(3) }
}

// The mixture described at the top: plays and scores, or does not play and scores nothing.
export function playerDay({ mean, sd, pPlay }) {
  const mu = pPlay * mean
  const variance = pPlay * (sd * sd + mean * mean) - mu * mu
  return { mu, variance: Math.max(0, variance) }
}

/**
 * A team's week. `players` each carry their projection and how many games they have left;
 * `starts` is how many of them can be in the lineup on a given day, so a day with eleven
 * games still only pays for the slots you have.
 *
 * Players are taken in order of mean, which is the lineup you would set anyway.
 */
export function teamWeek(players, { starts = 10, days = 7 } = {}) {
  const ranked = [...players].sort((a, b) => b.mean * b.pPlay - a.mean * a.pPlay)
  // You cannot start thirteen men in ten slots. Over the days left there are only so many
  // starts to give, and they go to your best players first — which is what you would do.
  // Without this the bench is counted as though it played, and a deep roster looks better
  // than it can ever be.
  let left = Math.max(0, starts * days)
  let mu = 0
  let variance = 0
  const perPlayer = []
  for (const p of ranked) {
    const day = playerDay(p)
    const played = Math.max(0, Math.min(p.games ?? 0, left))
    left -= played
    mu += day.mu * played
    variance += day.variance * played
    perPlayer.push({ ...p, games: played, mu: day.mu * played, variance: day.variance * played })
  }
  return { mu, variance, sd: Math.sqrt(variance), players: perPlayer }
}

/** The chance my week beats his, under the bell-curve approximation above. */
export function winProbability(me, opp) {
  const sd = Math.sqrt(me.variance + opp.variance)
  if (!sd) return me.mu === opp.mu ? 0.5 : me.mu > opp.mu ? 1 : 0
  return normalCdf((me.mu - opp.mu) / sd)
}

/**
 * The probability alone is a party trick. This is the part you act on: who moves the number,
 * by how much, and whether the week is being decided by players or by the calendar.
 */
export function weekOutlook(mine, theirs, opts = {}) {
  const me = teamWeek(mine, opts)
  const opp = teamWeek(theirs, opts)
  const pWin = winProbability(me, opp)

  // What the number becomes if one of mine sits the whole week. Recomputed, not estimated,
  // because "he is 8% of my week" and "losing him costs 8 points of win probability" are
  // different claims and only the second one is useful.
  const swing = me.players
    .filter((p) => p.games > 0)
    .map((p) => {
      const without = teamWeek(mine.filter((x) => x.id !== p.id), opts)
      return { id: p.id, name: p.name, games: p.games, points: +p.mu.toFixed(1), cost: +(pWin - winProbability(without, opp)).toFixed(4) }
    })
    .sort((a, b) => b.cost - a.cost)

  const myGames = me.players.reduce((n, p) => n + p.games, 0)
  const oppGames = opp.players.reduce((n, p) => n + p.games, 0)

  return {
    pWin,
    me: { mu: +me.mu.toFixed(1), sd: +me.sd.toFixed(1), games: myGames },
    opp: { mu: +opp.mu.toFixed(1), sd: +opp.sd.toFixed(1), games: oppGames },
    gameEdge: myGames - oppGames,
    swing: swing.slice(0, 5),
    // The one on his side who can beat you by himself: biggest mean, biggest spread.
    danger: [...opp.players].filter((p) => p.games > 0)
      .sort((a, b) => (b.mu + b.sd) - (a.mu + a.sd))[0] || null,
  }
}
