// Shared harness for the engine-v2 experiments. Nothing here is imported by the site.
//
// It rebuilds the same replay worker/backtest.mjs runs (same weeks, same forty drafts, same
// pairings, same box-score totals) but splits it in two: `buildFrame` does the slow part once,
// and each experiment then re-prices the same matchups with its own projection and its own
// week model. The rosters and the results never change between variants, so a difference in
// the score is a difference in the pricing and nothing else.
//
// Time split, used by every experiment: parameters are chosen on the first 11 graded weeks
// (FIT) and reported on the other 11 (TEST). Nothing is ever chosen on TEST.

import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { weekBounds } from '../../src/lib/model.js'
import { normalCdf, opponentFactor, playerDay, projectPlayer } from '../../src/lib/predict.js'
import { dvpFrom } from '../backtest.mjs'

export const HERE = dirname(fileURLToPath(import.meta.url))
const AS_ESPN = { G: 'PG', F: 'SF', C: 'C' }
const FORM_GAMES = 25
const MIN_GAMES = 5

export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5)
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

/** One season of game logs, oldest first, each row carrying what was knowable before tip-off. */
export function load(season = '2025-26') {
  const main = new DatabaseSync(join(HERE, '..', 'courtside.db'), { readOnly: true })
  const q = 'select player_id pid, game_id gid, game_date date, team, matchup, min, fp, pts from player_games where season = ?'
  let logs = main.prepare(q).all(season)
  const prev = join(HERE, 'prev.db')
  if (!logs.length && existsSync(prev)) logs = new DatabaseSync(prev, { readOnly: true }).prepare(q).all(season)
  if (!logs.length) throw new Error(`no games for ${season}; run fetch_prev.py for earlier seasons`)
  const pos = Object.fromEntries(main.prepare('select player_id, pos from player_pos').all().map((r) => [r.player_id, r.pos]))
  const rows = logs.map((r) => ({ ...r, opp: (r.matchup || '').split(' ').at(-1), home: (r.matchup || '').includes(' vs. ') }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { season, rows, pos, sched: enrich(rows) }
}

// One pass in date order. Before each game, write onto its rows what the engine could have
// known: is the team on the second night of a back-to-back, how many rotation minutes are
// missing tonight, and how lopsided the game looks. Then update the running state.
//   miss    minutes (running average) of teammates who played in one of the team's last 10
//           games and are not playing tonight
//   exp     expected margin for his team: difference of the two teams' running margins, plus
//           2.5 at home. A stand-in for the Vegas spread, which the replay has no archive of.
function enrich(rows) {
  const games = new Map()
  for (const r of rows) {
    if (!games.has(r.gid)) games.set(r.gid, { date: r.date, teams: new Map() })
    const g = games.get(r.gid)
    if (!g.teams.has(r.team)) g.teams.set(r.team, [])
    g.teams.get(r.team).push(r)
  }
  const pl = new Map()
  const tm = new Map()
  const sched = new Map() // team -> every game of the season, in order: the public calendar
  const T = (team) => {
    if (!tm.has(team)) tm.set(team, { idx: 0, last: null, rating: 0, members: new Set() })
    return tm.get(team)
  }
  for (const [gid, g] of games) {
    const sides = [...g.teams]
    const pts = sides.map(([, rs]) => rs.reduce((n, r) => n + (r.pts || 0), 0))
    sides.forEach(([team, rs], s) => {
      const t = T(team)
      const o = T(sides[1 - s]?.[0] ?? team)
      const playing = new Set(rs.filter((r) => r.min > 0).map((r) => r.pid))
      let miss = 0
      let missFp = 0
      for (const pid of t.members) {
        const p = pl.get(pid)
        if (!playing.has(pid) && t.idx - p.last <= 10) { miss += p.em; missFp += p.efp }
      }
      const b2b = t.last != null && dayDiff(g.date, t.last) === 1
      const home = rs[0].home
      const exp = t.rating - o.rating + (home ? 2.5 : -2.5)
      for (const r of rs) Object.assign(r, { miss, missFp, b2b, exp, tidx: t.idx })
      if (!sched.has(team)) sched.set(team, [])
      sched.get(team).push({ gid, date: g.date, opp: rs[0].opp, home, b2b, miss, exp })
    })
    sides.forEach(([team, rs], s) => {
      const t = T(team)
      const margin = pts[s] - pts[1 - s]
      for (const r of rs) {
        r.margin = margin
        if (!(r.min > 0)) continue
        let p = pl.get(r.pid)
        if (!p) { p = { em: r.min, efp: r.fp, team: null, last: 0 }; pl.set(r.pid, p) }
        if (p.team !== team) { tm.get(p.team)?.members.delete(r.pid); t.members.add(r.pid); p.team = team }
        p.em += 0.25 * (r.min - p.em)
        p.efp += 0.25 * (r.fp - p.efp)
        p.last = t.idx
        r.emAfter = p.em
      }
    })
    for (const [team] of sides) { const t = T(team); t.rating += 0.08 * (sides.length === 2 ? (pts[sides[0][0] === team ? 0 : 1] - pts[sides[0][0] === team ? 1 : 0]) - t.rating : 0); t.idx++; t.last = g.date }
  }
  return sched
}

/**
 * The fixed part of the replay: for each graded week, the players the engine could price on
 * Monday (with their history as of that morning), the forty drafts, the pairings, and what
 * each side really scored. Mirrors backtest.mjs `replay` line for line where it matters.
 */
export function buildFrame({ rows, pos, sched: fullSched }, { leagues = 40, teams = 10, roster = 13, starts = 10, skipWeeks = 3, seed = 7, extra = 30 } = {}) {
  const mondays = [...new Set(rows.map((r) => weekBounds(r.date)[0]))].sort()
  const hist = new Map()
  const sched = new Map()
  const seen = new Set()
  const prior = []
  const weeks = []
  let cursor = 0
  for (const [w, monday] of mondays.entries()) {
    const [, sunday] = weekBounds(monday)
    while (cursor < rows.length && rows[cursor].date < monday) {
      const r = rows[cursor++]
      if (!hist.has(r.pid)) hist.set(r.pid, [])
      hist.get(r.pid).push(r)
      if (!seen.has(`${r.team}|${r.gid}`)) {
        seen.add(`${r.team}|${r.gid}`)
        if (!sched.has(r.team)) sched.set(r.team, [])
        sched.get(r.team).push(r.gid)
      }
      prior.push(r)
    }
    let end = cursor
    while (end < rows.length && rows[end].date <= sunday) end++
    if (w < skipWeeks) continue
    const week = rows.slice(cursor, end)
    const scored = new Map()
    for (const r of week) {
      if (r.min > 0) {
        if (!scored.has(r.pid)) scored.set(r.pid, new Map())
        scored.get(r.pid).set(r.date, r)
      }
    }
    const slateOf = (team) => (fullSched.get(team) || []).filter((g) => g.date >= monday && g.date <= sunday)
    const dvp = dvpFrom(prior, pos)

    // Who is flagged out per team this Monday, and the minutes they take with them.
    const outMin = new Map()
    const rosters = new Map() // team -> everyone who played in one of its last 10 games
    const pool = []
    for (const [pid, hAll] of hist) {
      const team = hAll.at(-1).team
      const teamGames = sched.get(team) || []
      const mine = new Set(hAll.map((r) => r.gid))
      const last3 = teamGames.slice(-3)
      const missed = last3.filter((g) => !mine.has(g)).length
      const out = teamGames.length >= 3 && missed === 3
      const lastIdx = teamGames.length - 1 - [...teamGames].reverse().findIndex((g) => mine.has(g))
      const gap = teamGames.length - 1 - lastIdx // team games in a row he has missed
      if (out && gap <= 10) outMin.set(team, (outMin.get(team) || 0) + (hAll.at(-1).emAfter ?? 0))
      if (gap <= 10) {
        if (!rosters.has(team)) rosters.set(team, [])
        rosters.get(team).push({ pid, em: hAll.at(-1).emAfter ?? 0, missed, out, gap, avail: Math.min(1, hAll.length / (teamGames.length || 1)) })
      }
      if (hAll.length < MIN_GAMES) continue
      const last = hAll.slice(-FORM_GAMES)
      const fps = last.map((r) => r.fp)
      const m = mean(fps)
      const sd = Math.sqrt(fps.reduce((a, b) => a + (b - m) ** 2, 0) / (fps.length - 1))
      const form = { fp_mean: m, fp_sd: sd, g: last.length, avail: Math.min(1, hAll.length / (teamGames.length || 1)) }
      const base = projectPlayer({ form, status: out ? 'out' : 'ok', current: true })
      const slate = slateOf(team)
      const position = pos[pid] ? [AS_ESPN[pos[pid]]] : []
      pool.push({
        id: pid, pid, w, team, h: hAll.slice(), out, missed, gap, teamGames: teamGames.length, form, base,
        slate, dates: slate.map((g) => g.date), games: slate.length,
        dvp: slate.map((g) => opponentFactor(dvp, g.opp, position)),
        actual: scored.get(pid) || new Map(),
      })
    }
    for (const p of pool) p.teamOutMin = (outMin.get(p.team) || 0) - (p.out ? p.h.at(-1).emAfter ?? 0 : 0)
    pool.sort((a, b) => b.base.mean - a.base.mean)
    const size = teams * roster
    if (pool.length < size) continue
    const top = pool.slice(0, size + extra)
    // How often healthy fantasy-relevant men have been suiting up lately: of the team games in
    // the 21 days before Monday, the share the top 150 not flagged out actually played.
    let had = 0
    let could = 0
    const since = new Date(Date.parse(monday) - 21 * 864e5).toISOString().slice(0, 10)
    for (const c of pool.slice(0, 150)) {
      if (c.out) continue
      could += (fullSched.get(c.team) || []).filter((g) => g.date >= since && g.date < monday).length
      had += c.h.filter((r) => r.date >= since).length
    }
    const availIdx = could ? Math.min(0.99, had / could) : null

    const actual = (side) => {
      let total = 0
      const nights = new Map()
      for (const p of side) {
        for (const [d, r] of p.actual) {
          if (!nights.has(d)) nights.set(d, [])
          nights.get(d).push({ fp: r.fp, mean: p.base.mean })
        }
      }
      for (const slate of nights.values()) {
        slate.sort((a, b) => b.mean - a.mean)
        total += slate.slice(0, starts).reduce((n, x) => n + x.fp, 0)
      }
      return total
    }
    const matchups = []
    for (let l = 0; l < leagues; l++) {
      const r = rng(seed * 1e6 + w * 1000 + l)
      const order = top.map((p) => ({ p, s: p.base.mean * Math.exp(0.15 * gauss(r)) }))
        .sort((a, b) => b.s - a.s).slice(0, size)
      const sides = Array.from({ length: teams }, () => [])
      order.forEach(({ p }, i) => {
        const round = Math.floor(i / teams)
        const slot = i % teams
        sides[round % 2 ? teams - 1 - slot : slot].push(p)
      })
      const draw = sides.map((_, i) => i).sort(() => r() - 0.5)
      const rostered = new Set(order.map((x) => x.p.pid))
      for (let k = 0; k + 1 < draw.length; k += 2) {
        const a = sides[draw[k]]
        const b = sides[draw[k + 1]]
        matchups.push({ id: w * 10000 + l * 10 + k / 2, wk: w, l, a, b, my: actual(a), opp: actual(b), free: top.filter((p) => !rostered.has(p.pid)) })
      }
    }
    weeks.push({ w, monday, sunday, top, pool, matchups, rosters, availIdx })
  }
  const wks = weeks.map((x) => x.w)
  const mid = wks[Math.floor(wks.length / 2)]
  return { weeks, mid, starts, isFit: (wk) => wk < mid }
}

// ------------------------------------------------------------------ the week model

/**
 * predict.js `nightly`, copied, with two additions the experiments need: `pm`, a per-game
 * multiplier on the chance he plays (back-to-backs), and the third central moment of the
 * total, for the skew-aware odds. With no `pm` it returns exactly what predict.js returns.
 */
export function teamWeekX(players, { starts = 10, levelCv = 0.3, banked = 0, rho = 0 } = {}) {
  const nights = new Map()
  players.forEach((p, k) => (p.dates || []).forEach((d, i) => {
    if (!nights.has(d)) nights.set(d, [])
    nights.get(d).push({ k, f: p.adj?.[i] ?? 1, q: p.pPlay * (p.pm?.[i] ?? 1) })
  }))
  const acc = players.map(() => ({ mu: 0, variance: 0, games: 0, k3: 0, a1: 0, a2: 0 }))
  for (const slate of nights.values()) {
    slate.sort((a, b) => players[b.k].mean * b.q * b.f - players[a.k].mean * a.q * a.f)
    let room = starts
    for (const { k, f, q } of slate) {
      const p = players[k]
      const share = Math.min(1, Math.max(0, room))
      room -= q
      if (!share) continue
      const pp = q * share
      const m = p.mean * f
      const s = p.sd * f
      const day = playerDay({ mean: m, sd: s, pPlay: pp })
      acc[k].mu += day.mu
      acc[k].variance += day.variance
      acc[k].k3 += pp * (m ** 3 + 3 * m * s * s) - 3 * day.mu * pp * (s * s + m * m) + 2 * day.mu ** 3
      // For `rho`: absences within one man's week come in runs, not one coin a night.
      const a = m * Math.sqrt(pp * (1 - pp)); acc[k].a1 += a; acc[k].a2 += a * a
      if (share >= 0.5) acc[k].games++
    }
  }
  for (const x of acc) x.variance += (levelCv * x.mu) ** 2 + rho * (x.a1 ** 2 - x.a2)
  return {
    mu: banked + acc.reduce((n, x) => n + x.mu, 0),
    variance: acc.reduce((n, x) => n + x.variance, 0),
    k3: acc.reduce((n, x) => n + x.k3, 0),
    get sd() { return Math.sqrt(this.variance) },
    players: players.map((p, k) => ({ ...p, ...acc[k] })),
  }
}

/** Normal vs normal, with an optional spread scale and an optional Edgeworth skew term. */
export function winProb(a, b, { scale = 1, skew = false } = {}) {
  const v = a.variance + b.variance
  const sd = scale * Math.sqrt(v)
  if (!sd) return a.mu === b.mu ? 0.5 : a.mu > b.mu ? 1 : 0
  const z = (a.mu - b.mu) / sd
  let p = normalCdf(z)
  if (skew) {
    // P(D > 0) for D with skewness g: Phi(z) - phi(z) * g/6 * (z^2 - 1), first Edgeworth term.
    const g = ((a.k3 ?? 0) - (b.k3 ?? 0)) / (scale * Math.sqrt(v)) ** 3
    p -= Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * (g / 6) * (z * z - 1)
  }
  return Math.min(1, Math.max(0, p))
}

// The baseline projection: exactly what the replay hands teamWeek today.
export const baseProject = (c) => ({ ...c.base, adj: c.dvp })

/**
 * Price every matchup in the frame. `project(ctx, week)` returns { mean, sd, pPlay, adj?, pm? }
 * for one player; `opts` go to teamWeekX and winProb. Returns ledger entries.
 */
export function price(frame, { project = baseProject, levelCv = 0.3, rho = 0, scale = 1, skew = false, scaleFn = null, pFn = null } = {}) {
  const out = []
  for (const wk of frame.weeks) {
    const proj = new Map()
    for (const c of wk.top) proj.set(c.pid, { id: c.pid, dates: c.dates, games: c.games, ...project(c, wk) })
    const sc = scaleFn ? scaleFn(wk, out) : scale
    for (const m of wk.matchups) {
      const ta = teamWeekX(m.a.map((c) => proj.get(c.pid)), { starts: frame.starts, levelCv, rho })
      const tb = teamWeekX(m.b.map((c) => proj.get(c.pid)), { starts: frame.starts, levelCv, rho })
      const pWin = pFn ? pFn(m, proj, ta, tb, wk) : winProb(ta, tb, { scale: sc, skew })
      out.push({ id: m.id, wk: m.wk, pWin, myMu: ta.mu, mySd: ta.sd, oppMu: tb.mu, oppSd: tb.sd, my: m.my, opp: m.opp, won: m.my > m.opp, tie: m.my === m.opp })
    }
  }
  return out
}

// ------------------------------------------------------------------ scoring

/** Everything the spec reports, for one set of ledger entries. */
export function metrics(entries) {
  const done = entries.filter((e) => !e.tie)
  const clip = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p))
  const brier = mean(done.map((e) => (e.pWin - (e.won ? 1 : 0)) ** 2))
  const logloss = -mean(done.map((e) => Math.log(clip(e.won ? e.pWin : 1 - e.pWin))))
  const sides = done.flatMap((e) => [{ mu: e.myMu, sd: e.mySd, got: e.my }, { mu: e.oppMu, sd: e.oppSd, got: e.opp }])
  const err = sides.map((x) => x.got - x.mu)
  const deciles = []
  for (let i = 0; i < 10; i++) {
    const inB = done.filter((e) => e.pWin >= i / 10 && (i === 9 ? e.pWin <= 1 : e.pWin < (i + 1) / 10))
    if (inB.length) deciles.push({ bin: `${i * 10}-${i * 10 + 10}`, n: inB.length, said: +mean(inB.map((e) => e.pWin)).toFixed(3), won: +(inB.filter((e) => e.won).length / inB.length).toFixed(3) })
  }
  return {
    n: done.length,
    brier: +brier.toFixed(4),
    logloss: +logloss.toFixed(4),
    bias: +mean(err).toFixed(1),
    mae: +mean(err.map(Math.abs)).toFixed(1),
    in1sd: +(sides.filter((x) => Math.abs(x.got - x.mu) <= x.sd).length / sides.length).toFixed(3),
    z2: +mean(sides.map((x) => ((x.got - x.mu) / x.sd) ** 2)).toFixed(3),
    marginZ2: +mean(done.map((e) => ((e.my - e.opp) - (e.myMu - e.oppMu)) ** 2 / (e.mySd ** 2 + e.oppSd ** 2))).toFixed(3),
    // Calibration as one number: mean |said - won| over deciles, weighted by how full each is.
    calErr: +(deciles.reduce((n, d) => n + d.n * Math.abs(d.said - d.won), 0) / done.length).toFixed(4),
    deciles,
  }
}

export const split = (frame, entries) => ({
  fit: metrics(entries.filter((e) => frame.isFit(e.wk))),
  test: metrics(entries.filter((e) => !frame.isFit(e.wk))),
  all: metrics(entries),
})

/**
 * Is a Brier difference on the test weeks more than luck? The 2,200 test matchups are not
 * 2,200 independent weeks: forty leagues share the same players and the same seven nights.
 * So resample whole weeks, not matchups. Returns the mean difference (b minus a, negative is
 * better) and the share of resamples in which b was better.
 */
export function pairedWeeks(frame, a, b, { test = true, n = 2000 } = {}) {
  const byWeek = new Map()
  a.forEach((e, i) => {
    if (e.tie || frame.isFit(e.wk) === test) return
    if (!byWeek.has(e.wk)) byWeek.set(e.wk, [])
    const y = e.won ? 1 : 0
    byWeek.get(e.wk).push((b[i].pWin - y) ** 2 - (e.pWin - y) ** 2)
  })
  const wks = [...byWeek.values()]
  const r = rng(11)
  let better = 0
  const diffs = []
  for (let k = 0; k < n; k++) {
    let s = 0
    let c = 0
    for (let j = 0; j < wks.length; j++) { const x = wks[Math.floor(r() * wks.length)]; for (const d of x) s += d; c += x.length }
    diffs.push(s / c)
    if (s < 0) better++
  }
  diffs.sort((x, y) => x - y)
  return { diff: +mean(wks.flat()).toFixed(4), pBetter: +(better / n).toFixed(2), lo: +diffs[Math.floor(n * 0.05)].toFixed(4), hi: +diffs[Math.floor(n * 0.95)].toFixed(4) }
}

/**
 * Player-game accuracy of a projection made on Monday for the week's games. Far more
 * sensitive than the matchup score: about 9,000 player-games a half instead of 11 weeks.
 *   rmse/mae/bias  on games he played: actual fp minus projected mean (after any adj)
 *   playBrier      on every scheduled game: (pPlay - played)^2
 *   evBias         actual points (zero if he sat) minus pPlay * mean, per scheduled game
 */
export function playerScore(frame, project = baseProject, { test, cut = 130 } = {}) {
  let se = 0; let ae = 0; let be = 0; let n = 0; let pb = 0; let ev = 0; let g = 0; let said = 0; let played = 0
  for (const wk of frame.weeks) {
    if (test != null && frame.isFit(wk.w) === test) continue
    for (const c of wk.top.slice(0, cut)) {
      const p = project(c, wk)
      c.slate.forEach((gm, i) => {
        const m = p.mean * (p.adj?.[i] ?? 1)
        const q = p.pPlay * (p.pm?.[i] ?? 1)
        const r = c.actual.get(gm.date)
        g++; said += q; pb += (q - (r ? 1 : 0)) ** 2; ev += (r ? r.fp : 0) - q * m
        if (r) { played++; n++; se += (r.fp - m) ** 2; ae += Math.abs(r.fp - m); be += r.fp - m }
      })
    }
  }
  return { n, rmse: +Math.sqrt(se / n).toFixed(3), mae: +(ae / n).toFixed(3), bias: +(be / n).toFixed(3), games: g, playSaid: +(said / g).toFixed(3), playWas: +(played / g).toFixed(3), playBrier: +(pb / g).toFixed(4), evBias: +(ev / g).toFixed(3) }
}

export const row = (label, m) => `${label.padEnd(34)} brier ${m.brier.toFixed(4)}  logloss ${m.logloss.toFixed(4)}  cal ${m.calErr.toFixed(4)}  bias ${String(m.bias).padStart(6)}  miss ${String(m.mae).padStart(6)}  in1sd ${(m.in1sd * 100).toFixed(0)}%  z2 ${m.z2}  mz2 ${m.marginZ2}`
