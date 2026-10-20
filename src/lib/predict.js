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

import { normName } from './model.js'

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

// ---------------------------------------------------------------- the opponent

// ESPN and the NBA disagree about six abbreviations. The schedule in the app is ESPN's;
// dvp.json comes from the NBA feed. This is the only place the two namespaces meet.
const NBA_ABBREV = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' }
export const nbaAbbrev = (espn) => NBA_ABBREV[espn] ?? espn

// Guard, forward, centre — no finer. Split it to five and most team-position cells rest on
// too few games to mean anything, and the table starts inventing differences.
const BUCKET = { PG: 'G', SG: 'G', SF: 'F', PF: 'F', C: 'C' }

/**
 * How much one opponent moves a player's night, as a multiplier on his average.
 *
 * 1.00 whenever we cannot say: no table yet, an unknown team, a player with no position.
 * That is deliberate — an unknown adjustment should leave the projection exactly where it
 * was rather than quietly dropping the player out of it. A player eligible at two positions
 * gets the average of the two, because the defence does not know which one he is listed at.
 */
export function opponentFactor(dvp, oppAbbrev, positions = []) {
  const team = dvp?.teams?.[nbaAbbrev(oppAbbrev)]
  if (!team) return 1
  const mults = [...new Set(positions.map((x) => BUCKET[x]).filter(Boolean))]
    .map((b) => team[b]?.mult).filter((m) => m != null)
  if (!mults.length) return 1
  return mults.reduce((a, b) => a + b, 0) / mults.length
}

/**
 * A team's week. `players` each carry their projection and how many games they have left;
 * `starts` is how many of them can be in the lineup on a given day, so a day with eleven
 * games still only pays for the slots you have.
 *
 * Players are taken in order of mean, which is the lineup you would set anyway.
 *
 * Each player may carry `adj`: one multiplier per remaining game, in date order, from
 * opponentFactor above. A player facing Washington twice is worth more than the same player
 * facing Boston twice, and until phase 5 that difference was invisible here. No `adj` means
 * every game counts at face value, which is exactly what phases 3 and 4 did.
 *
 * Each player may also carry `dates`, one per remaining game, parallel to `adj`. With them
 * the cap is applied night by night, which is how ESPN applies it: a Wednesday where twelve
 * of your men play still starts ten, and a Monday where four play starts four. Without them
 * the cap is pooled over the week, which is right on average and wrong on the nights that
 * decide close weeks.
 *
 * `banked` is what the team has already scored this week. It has no spread — it happened —
 * so it moves the total and leaves the variance alone.
 */
// How sure we are of a player's level this week, as a share of his week. Nights are not
// independent draws: the same man brings the same role, the same minutes and the same
// sore ankle to all four of his games, so a bad week is bad all week. Without this term
// the spread counted only night-to-night luck, and the replay of 2025-26 caught it — weeks
// missed by half again what the model claimed, and its 93% weeks were won 82% of the time.
// 0.3 was picked on the first half of that season and checked on the second, where it cut
// the Brier score from 0.203 to 0.192. Re-run `npm run backtest` before changing it.
const LEVEL_CV = 0.3
const meanAdj = (p) => (p.adj?.length ? p.adj.reduce((a, b) => a + b, 0) / p.adj.length : 1)

export function teamWeek(players, { starts = 10, days = 7, banked = 0, levelCv = LEVEL_CV } = {}) {
  if (players.some((p) => p.dates?.length)) return nightly(players, starts, banked, levelCv)
  const ranked = [...players].sort((a, b) => b.mean * b.pPlay * meanAdj(b) - a.mean * a.pPlay * meanAdj(a))
  // You cannot start thirteen men in ten slots. Over the days left there are only so many
  // starts to give, and they go to your best players first — which is what you would do.
  // Without this the bench is counted as though it played, and a deep roster looks better
  // than it can ever be.
  let left = Math.max(0, starts * days)
  let mu = banked
  let variance = 0
  const perPlayer = []
  for (const p of ranked) {
    const played = Math.max(0, Math.min(p.games ?? 0, left))
    left -= played
    // Night by night, because the opponent changes between them. A defence that holds a
    // player to 90% holds his spread to 90% too: the whole night shrinks, not just its
    // middle, so the same factor multiplies mean and sd.
    let pmu = 0
    let pvar = 0
    for (let i = 0; i < played; i++) {
      const f = p.adj?.[i] ?? 1
      const day = playerDay({ mean: p.mean * f, sd: p.sd * f, pPlay: p.pPlay })
      pmu += day.mu
      pvar += day.variance
    }
    pvar += (levelCv * pmu) ** 2
    mu += pmu
    variance += pvar
    perPlayer.push({ ...p, games: played, mu: pmu, variance: pvar })
  }
  return { mu, variance, sd: Math.sqrt(variance), players: perPlayer }
}

// The cap, one night at a time. Each night the men with a game are taken best first, and
// each one uses up as much of a slot as he is likely to fill: a starter who is 90% to play
// leaves a tenth of his slot to whoever is next. So the eleventh man on a busy night is not
// worth nothing — he is the cover for the ten in front of him — and on a quiet night he is
// worth his full self. A man is counted on a night only if he is more likely than not to
// have a slot, which is what `games` reports.
// ponytail: expected slot share, not an exact lineup. The exact answer is a sum over every
// combination of who sits; for ten slots that is 2^13 cases a night and changes the total
// by a point or two.
function nightly(players, starts, banked, levelCv) {
  const nights = new Map()
  players.forEach((p, k) => (p.dates || []).forEach((d, i) => {
    if (!nights.has(d)) nights.set(d, [])
    nights.get(d).push({ k, f: p.adj?.[i] ?? 1 })
  }))
  const acc = players.map(() => ({ mu: 0, variance: 0, games: 0 }))
  for (const slate of nights.values()) {
    slate.sort((a, b) => players[b.k].mean * players[b.k].pPlay * b.f - players[a.k].mean * players[a.k].pPlay * a.f)
    let room = starts
    for (const { k, f } of slate) {
      const p = players[k]
      const share = Math.min(1, Math.max(0, room))
      room -= p.pPlay
      if (!share) continue
      const day = playerDay({ mean: p.mean * f, sd: p.sd * f, pPlay: p.pPlay * share })
      acc[k].mu += day.mu
      acc[k].variance += day.variance
      if (share >= 0.5) acc[k].games++
    }
  }
  for (const x of acc) x.variance += (levelCv * x.mu) ** 2
  const perPlayer = players.map((p, k) => ({ ...p, ...acc[k] }))
    .sort((a, b) => b.mu - a.mu)
  const mu = banked + acc.reduce((n, x) => n + x.mu, 0)
  const variance = acc.reduce((n, x) => n + x.variance, 0)
  return { mu, variance, sd: Math.sqrt(variance), players: perPlayer }
}

/**
 * The chance my week beats his, under the bell-curve approximation above.
 *
 * `scale` widens the spread by what grading measured. The independence assumption at the top
 * makes every week look more certain than it is; the replay of last season and the ledger
 * both measure by how much, and this is where that measurement is paid back. 1 means trust
 * the raw spread.
 */
export function winProbability(me, opp, scale = 1) {
  const sd = scale * Math.sqrt(me.variance + opp.variance)
  if (!sd) return me.mu === opp.mu ? 0.5 : me.mu > opp.mu ? 1 : 0
  return normalCdf((me.mu - opp.mu) / sd)
}

/**
 * The probability alone is a party trick. This is the part you act on: who moves the number,
 * by how much, and whether the week is being decided by players or by the calendar.
 */
export function weekOutlook(mine, theirs, { banked = [0, 0], sdScale = 1, ...opts } = {}) {
  const mineOpts = { ...opts, banked: banked[0] }
  const me = teamWeek(mine, mineOpts)
  const opp = teamWeek(theirs, { ...opts, banked: banked[1] })
  const pWin = winProbability(me, opp, sdScale)

  // What the number becomes if one of mine sits the whole week. Recomputed, not estimated,
  // because "he is 8% of my week" and "losing him costs 8 points of win probability" are
  // different claims and only the second one is useful.
  const swing = me.players
    .filter((p) => p.games > 0)
    .map((p) => {
      const without = teamWeek(mine.filter((x) => x.id !== p.id), mineOpts)
      return { id: p.id, name: p.name, games: p.games, points: +p.mu.toFixed(1), cost: +(pWin - winProbability(without, opp, sdScale)).toFixed(4) }
    })
    .sort((a, b) => b.cost - a.cost)

  const myGames = me.players.reduce((n, p) => n + p.games, 0)
  const oppGames = opp.players.reduce((n, p) => n + p.games, 0)

  // What the opponent adjustment is actually worth to me this week. Without it there is no
  // way to tell whether the defence table is doing work or just adding decimal places, and
  // a model you cannot audit from the outside is a model you have to take on faith.
  const flat = teamWeek(mine.map((p) => ({ ...p, adj: null })), mineOpts)
  const matchupEdge = mine.some((p) => p.adj?.length) ? +(me.mu - flat.mu).toFixed(1) : null

  return {
    pWin,
    // The same week before grading widened it. Recorded beside pWin so the ledger can keep
    // measuring the raw model rather than its own correction.
    pWinRaw: winProbability(me, opp),
    sdScale,
    me: { mu: +me.mu.toFixed(1), sd: +me.sd.toFixed(1), games: myGames, banked: banked[0] },
    opp: { mu: +opp.mu.toFixed(1), sd: +opp.sd.toFixed(1), games: oppGames, banked: banked[1] },
    gameEdge: myGames - oppGames,
    matchupEdge,
    swing: swing.slice(0, 5),
    // The one on his side who can beat you by himself: biggest mean, biggest spread.
    danger: [...opp.players].filter((p) => p.games > 0)
      .sort((a, b) => (b.mu + b.sd) - (a.mu + a.sd))[0] || null,
  }
}


// ---------------------------------------------------------------- phase 6: the detail

/**
 * Who has guarded this man, and how it went — possession by possession, from the NBA's own
 * matchup data. Nothing in ESPN tells you this.
 *
 * `facing` is the list of teams he meets in the stretch you care about, in ESPN's spelling.
 * Defenders currently on one of those teams float to the top and are marked, because a
 * career 31% against someone retired is trivia and the same number against Thursday's
 * starting guard is a reason to sit him.
 *
 * Returns [] whenever we cannot say: no table, or a player the table has never seen.
 */
export function defenderHistory(matchups, playerName, facing = []) {
  const id = matchups?.by_norm?.[normName(playerName)]
  const rows = id == null ? null : matchups.scorers?.[id]
  if (!rows) return []
  const meets = new Set(facing.filter(Boolean).map(nbaAbbrev))
  return rows
    .map((r) => {
      const team = matchups.now?.[r.d] ?? null
      return {
        id: r.d,
        name: matchups.names?.[r.d] ?? String(r.d),
        team,
        gp: r.gp,
        poss: r.poss,
        pts100: r.pts100,
        fga: r.fga,
        fg: r.fg,
        tov: r.tov,
        thisWeek: !!(team && meets.has(team)),
      }
    })
    .sort((a, b) => (b.thisWeek - a.thisWeek) || (b.poss - a.poss))
}

/**
 * Everyone this player has been named alongside in a flagrant foul or a double technical.
 *
 * This feeds no projection and it never will. There is no defensible way to turn "these two
 * have come to blows twice" into a minutes number, and anything that claimed to would make
 * every number downstream dishonest. It is surfaced, tagged, and left to you.
 */
export function frictionFor(friction, playerName) {
  const me = normName(playerName)
  const out = []
  for (const r of friction?.pairs || []) {
    // The worker writes the same normalisation it used; fall back to doing it here so an
    // older file still joins.
    const a = r.a_norm ?? normName(r.a_name)
    const b = r.b_norm ?? normName(r.b_name)
    if (a !== me && b !== me) continue
    out.push({ name: a === me ? r.b_name : r.a_name, n: r.n, kinds: r.kinds, last: r.last })
  }
  return out.sort((x, y) => y.n - x.n)
}

// ---------------------------------------------------------------- phase 7: the event feed

// Tags that are allowed to move p_play, and tags that are only ever shown.
//
// The line between them is whether the event states something about availability on its
// own. "Ruled out" and "suspended five games" do: they are the league or the team saying
// he will not be on the floor, and pricing them is arithmetic. An arrest, a lawsuit, a
// bereavement, a divorce do not. They raise the chance of missed games by an amount nobody
// can honestly name, and a number invented for them would quietly contaminate the win
// probability, the swing table and every waiver suggestion downstream. So they are tagged,
// dated, and put in front of you with the reasoning left where it belongs.
export const PRICED_TAGS = ['out', 'suspended']
export const SHOWN_TAGS = ['legal', 'personal']

const HARD_OUT = ['OUT', 'INJURY_RESERVE', 'SUSPENSION']
const HARD_DTD = ['DAY_TO_DAY', 'QUESTIONABLE', 'DOUBTFUL']
const hasTag = (item, k) => (item.tags || []).some((t) => (t.k ?? t) === k)

/**
 * Whether he plays, and what said so.
 *
 * One function because there were two, and they had already drifted: the matchup page read
 * the fantasy flag and the rest of the app read the injury report, so the same player could
 * be out on one screen and fine on another. Everything that needs a status calls this.
 *
 * Sources in order of authority:
 *   1. ESPN's own fantasy flag — out, injured reserve, suspended
 *   2. the official injury report
 *   3. the news feed, which is routinely hours ahead of both
 *
 * A hard flag is never overridden by news. Being wrongly cautious costs a bench slot;
 * being wrongly optimistic costs the week, and those are not the same mistake.
 *
 * `news` items are the app's own tagged items: { title, date, src, tags }.
 *
 * `offCourt` is the wider press sweep, and it is held to a lower privilege on purpose: it
 * can raise a flag but it can never bench anyone. General news headlines are written to be
 * read, not parsed — "ruled out of the MVP race" and "suspended disbelief" both carry the
 * words that would zero a projection, and the cost of that mistake is the whole week.
 * Pricing stays with the feeds that are written about availability.
 */
export function availability({ inj, report, news = [], offCourt = [], now = Date.now(), freshHours = 36, flagDays = 7 } = {}) {
  const fresh = (item, hours) => {
    const t = Date.parse(item?.date ?? '')
    return Number.isNaN(t) ? false : t >= now - hours * 3600e3
  }

  // Off-court events worth reading, priced at nothing on purpose.
  const flags = []
  for (const item of [...news, ...offCourt]) {
    if (!fresh(item, flagDays * 24)) continue
    for (const k of SHOWN_TAGS) {
      if (hasTag(item, k)) flags.push({ tag: k, title: item.title, date: item.date, src: item.src })
    }
  }
  const out = (why, source) => ({ status: 'out', why, source, flags })
  const dtd = (why, source) => ({ status: 'dtd', why, source, flags })

  if (HARD_OUT.includes(inj)) {
    return out(inj === 'SUSPENSION' ? 'Suspended' : inj === 'INJURY_RESERVE' ? 'On injured reserve' : 'Ruled out', 'ESPN')
  }
  if (report?.status === 'Out') return out(report.comment || 'Ruled out', 'injury report')

  for (const item of news) {
    if (!fresh(item, freshHours)) continue
    // "Returns from suspension Friday" carries the word that would otherwise bench him.
    // The return is the newer fact, so it cancels the item's own out signal.
    if (hasTag(item, 'roleup')) continue
    const hit = PRICED_TAGS.find((k) => hasTag(item, k))
    if (hit) return out(item.title, item.src || 'news')
  }

  if (HARD_DTD.includes(inj)) return dtd('Game-time decision', 'ESPN')
  if (report?.status === 'Day-To-Day') return dtd(report.comment || 'Day-to-day', 'injury report')
  for (const item of news) {
    if (fresh(item, freshHours) && !hasTag(item, 'roleup') && hasTag(item, 'questionable')) {
      return dtd(item.title, item.src || 'news')
    }
  }
  return { status: 'ok', why: null, source: null, flags }
}
