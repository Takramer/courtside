// Phase 9: grade the engine on a season that has already happened.
//
//     npm run backtest           replays 2025-26 -> public/data/backtest.json
//     npm run backtest 2025-26   any season in courtside.db
//
// The ledger can only grade the weeks you have actually played, which is twenty-odd a
// season, and decision 18 says a probability needs about that many before it can be read at
// all. So the honest scorecard would arrive in March. This one arrives tonight.
//
// It walks last season one week at a time. Before each Monday it knows only the games played
// before that Monday: form from the last 25 of them, availability from how often each man
// suited up, the defence table rebuilt from those games alone. It drafts forty imaginary
// ten-team leagues out of that knowledge, prices every matchup with the same predict.js the
// site runs, then plays the week out of the real box scores. Then grade.js scores it, the
// same way it scores your ledger.
//
// What it cannot see, and so does not test:
//   - ESPN's preseason projection. There is no archive of it, so every projection here is
//     form alone. The live blend with ESPN can only be graded by the ledger.
//   - The injury report. A man who missed his team's last three games is treated as ruled
//     out, which is roughly what the report would have said. Late scratches are not caught.
//   - Position slots. Lineups here are the best ten each night, the same simplification
//     predict.js makes. Real ESPN slots bench a third centre now and then.
// So it grades the parts of the engine that do the most work — the spread, the availability
// mixture, the nightly cap, the defence table and the bell curve — and not the rest.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { weekBounds } from '../src/lib/model.js'
import { opponentFactor, projectPlayer, teamWeek, winProbability } from '../src/lib/predict.js'
import { score, spreadScale } from '../src/lib/grade.js'

const HERE = dirname(fileURLToPath(import.meta.url))

// The same knobs ingest.py uses for dvp.json, so the replayed table is the table the site has.
const DVP_K = 150
const DVP_CLAMP = 0.12
const DVP_MIN_MIN = 10
const FORM_GAMES = 25
const MIN_GAMES = 5

// The worker stores G, F or C; opponentFactor reads ESPN positions.
const AS_ESPN = { G: 'PG', F: 'SF', C: 'C' }

// Seeded, so the same season replays to the same numbers and a change in the score means a
// change in the model, not in the dice.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())

const opponentOf = (matchup) => {
  const parts = (matchup || '').split(' ')
  return parts.length >= 3 ? parts.at(-1) : null
}

/** dvp.json as it would have read on the morning of `rows`' last day. Mirrors ingest.py dvp_rows. */
export function dvpFrom(rows, pos) {
  const league = {}
  const allowed = {}
  for (const r of rows) {
    const bucket = pos[r.pid]
    if (!bucket || !r.opp || !(r.min >= DVP_MIN_MIN)) continue
    const fp36 = (r.fp / r.min) * 36
    for (const [key, store] of [[bucket, league], [`${r.opp}|${bucket}`, allowed]]) {
      const cell = (store[key] ??= [0, 0])
      cell[0] += fp36
      cell[1]++
    }
  }
  const teams = {}
  for (const [key, [total, n]] of Object.entries(allowed)) {
    const [team, bucket] = key.split('|')
    const ref = league[bucket] && league[bucket][0] / league[bucket][1]
    if (!ref) continue
    const mult = 1 + (total / n / ref - 1) * (n / (n + DVP_K))
    ;(teams[team] ??= {})[bucket] = { mult: Math.min(1 + DVP_CLAMP, Math.max(1 - DVP_CLAMP, mult)) }
  }
  return { teams }
}

/**
 * The replay. `logs` are { pid, gid, date, team, opp, min, fp }, one per player-game; `pos`
 * maps pid to G, F or C. Returns a ledger in the shape grade.js already scores, one entry per
 * matchup, each carrying `wk` — the replay week it came from — so it can be split in time.
 */
export function replay(logs, { pos = {}, leagues = 40, teams = 10, roster = 13, starts = 10, skipWeeks = 3, seed = 7, useDvp = true, levelCv } = {}) {
  const rows = [...logs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const mondays = [...new Set(rows.map((r) => weekBounds(r.date)[0]))].sort()
  const hist = new Map() // pid -> his games so far, oldest first
  const sched = new Map() // team -> game ids so far, oldest first
  const seen = new Set()
  const prior = []
  const ledger = {}
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

    // The week's calendar, which a manager knows on Monday, and its box scores, which he does not.
    const games = new Map() // team -> [{ date, opp }] in date order
    const scored = new Map() // pid -> Map(date -> fp)
    const known = new Set()
    for (const r of week) {
      if (!known.has(`${r.team}|${r.gid}`)) {
        known.add(`${r.team}|${r.gid}`)
        if (!games.has(r.team)) games.set(r.team, [])
        games.get(r.team).push({ date: r.date, opp: r.opp })
      }
      if (r.min > 0) {
        if (!scored.has(r.pid)) scored.set(r.pid, new Map())
        scored.get(r.pid).set(r.date, r.fp)
      }
    }
    for (const g of games.values()) g.sort((a, b) => (a.date < b.date ? -1 : 1))
    const dvp = useDvp ? dvpFrom(prior, pos) : null

    // Everyone the engine could have priced on Monday morning, as form.json would have had him.
    const pool = []
    for (const [pid, h] of hist) {
      const last = h.slice(-FORM_GAMES)
      if (last.length < MIN_GAMES) continue
      const fps = last.map((r) => r.fp)
      const m = fps.reduce((a, b) => a + b, 0) / fps.length
      const sd = Math.sqrt(fps.reduce((a, b) => a + (b - m) ** 2, 0) / (fps.length - 1))
      const team = h.at(-1).team
      const teamGames = sched.get(team) || []
      const mine = new Set(h.map((r) => r.gid))
      const out = teamGames.length >= 3 && teamGames.slice(-3).every((g) => !mine.has(g))
      const form = { fp_mean: m, fp_sd: sd, g: last.length, avail: Math.min(1, h.length / (teamGames.length || 1)) }
      const proj = projectPlayer({ form, status: out ? 'out' : 'ok', current: true })
      const slate = games.get(team) || []
      const position = pos[pid] ? [AS_ESPN[pos[pid]]] : []
      pool.push({
        id: pid, ...proj, games: slate.length,
        dates: slate.map((g) => g.date),
        adj: dvp ? slate.map((g) => opponentFactor(dvp, g.opp, position)) : null,
      })
    }
    pool.sort((a, b) => b.mean - a.mean)
    const size = teams * roster
    if (pool.length < size) continue
    const top = pool.slice(0, size + 30)

    // What the week actually paid: each night, the best men who really played, ten at most,
    // chosen by projection — the manager sets the lineup, he does not see the box score.
    const actual = (side) => {
      let total = 0
      const nights = new Map()
      for (const p of side) {
        for (const [d, fp] of scored.get(p.id) || []) {
          if (!nights.has(d)) nights.set(d, [])
          nights.get(d).push({ fp, mean: p.mean })
        }
      }
      for (const slate of nights.values()) {
        slate.sort((a, b) => b.mean - a.mean)
        total += slate.slice(0, starts).reduce((n, x) => n + x.fp, 0)
      }
      return total
    }

    for (let l = 0; l < leagues; l++) {
      const r = rng(seed * 1e6 + w * 1000 + l)
      // A draft is the consensus with opinions in it: ranked by form, with enough noise
      // that no two leagues come out the same.
      const order = top.map((p) => ({ p, s: p.mean * Math.exp(0.15 * gauss(r)) }))
        .sort((a, b) => b.s - a.s).slice(0, size)
      const sides = Array.from({ length: teams }, () => [])
      order.forEach(({ p }, i) => {
        const round = Math.floor(i / teams)
        const slot = i % teams
        sides[round % 2 ? teams - 1 - slot : slot].push(p)
      })
      const draw = sides.map((_, i) => i).sort(() => r() - 0.5)
      for (let k = 0; k + 1 < draw.length; k += 2) {
        const a = sides[draw[k]]
        const b = sides[draw[k + 1]]
        const ta = teamWeek(a, { starts, levelCv })
        const tb = teamWeek(b, { starts, levelCv })
        const my = actual(a)
        const opp = actual(b)
        const id = w * 10000 + l * 10 + k / 2
        ledger[id] = {
          week: id, wk: w, pWin: winProbability(ta, tb), daysLeft: 7,
          myMu: ta.mu, mySd: ta.sd, oppMu: tb.mu, oppSd: tb.sd,
          final: { my, opp, won: my > opp, tie: my === opp },
        }
      }
    }
  }
  return ledger
}

/** Re-price a ledger's probabilities under a wider spread, without re-running the week. */
export function rescale(ledger, scale) {
  const out = {}
  for (const [k, e] of Object.entries(ledger)) {
    out[k] = { ...e, pWin: winProbability({ mu: e.myMu, variance: e.mySd ** 2 }, { mu: e.oppMu, variance: e.oppSd ** 2 }, scale) }
  }
  return out
}

const pick = (ledger, keep) => Object.fromEntries(Object.entries(ledger).filter(([, e]) => keep(e)))

/**
 * What goes in backtest.json. The spread is fitted on the first half of the season and
 * tested on the second, because a correction measured and graded on the same weeks will
 * always look like it works.
 */
export function summarise(withDvp, withoutDvp, withoutLevel) {
  const s = score(withDvp)
  const flat = score(withoutDvp)
  const wks = [...new Set(Object.values(withDvp).map((e) => e.wk))].sort((a, b) => a - b)
  const mid = wks[Math.floor(wks.length / 2)]
  const early = pick(withDvp, (e) => e.wk < mid)
  const late = pick(withDvp, (e) => e.wk >= mid)
  const fitted = spreadScale({ replay: score(early).margin })
  const lean = ({ brier, buckets, points, margin, record, graded }) => ({ graded, brier, buckets, points, margin, record })
  return {
    ...lean(s),
    baseline: 0.25,
    holdout: {
      fitWeeks: wks.filter((w) => w < mid).length,
      testWeeks: wks.filter((w) => w >= mid).length,
      scale: fitted,
      brierRaw: score(late).brier,
      brierScaled: score(rescale(late, fitted)).brier,
    },
    // Does the defence table earn its place? Same leagues, same weeks, with it and without.
    dvp: { brierWith: s.brier, brierWithout: flat.brier, maeWith: s.points?.mae, maeWithout: flat.points?.mae },
    // And the level term in predict.js: the same weeks with every night independent again.
    level: { brierWith: s.brier, brierWithout: score(withoutLevel).brier, z2Without: score(withoutLevel).margin?.z2 },
  }
}

async function main() {
  const season = process.argv[2] || '2025-26'
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(HERE, 'courtside.db'), { readOnly: true })
  const logs = db.prepare('select player_id pid, game_id gid, game_date date, team, matchup, min, fp from player_games where season = ?')
    .all(season).map((r) => ({ ...r, opp: opponentOf(r.matchup) }))
  if (!logs.length) {
    console.error(`  no games for ${season} in courtside.db — run python ingest.py logs first`)
    process.exit(1)
  }
  const pos = Object.fromEntries(db.prepare('select player_id, pos from player_pos').all().map((r) => [r.player_id, r.pos]))
  const t0 = Date.now()
  const withDvp = replay(logs, { pos })
  const withoutDvp = replay(logs, { pos, useDvp: false })
  const withoutLevel = replay(logs, { pos, levelCv: 0 })
  const out = {
    updated: new Date().toISOString().slice(0, 19) + 'Z',
    season,
    leagues: 40,
    note: 'Last season replayed week by week through predict.js, knowing only the games before each Monday. Form only: no ESPN projection, no injury report beyond three straight missed games, best ten each night with no position slots.',
    ...summarise(withDvp, withoutDvp, withoutLevel),
  }
  writeFileSync(join(HERE, '..', 'public', 'data', 'backtest.json'), JSON.stringify(out))
  const p = out.points
  console.log(`  ${season}: ${out.graded} matchups over ${out.holdout.fitWeeks + out.holdout.testWeeks} weeks in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`  brier ${out.brier} against 0.25 for a coin; with no defence table ${out.dvp.brierWithout}`)
  console.log(`  points: bias ${p.bias}, typical miss ${p.mae}, ${Math.round(p.within1sd * 100)}% inside one sd (claims 68%), z2 ${p.z2}`)
  console.log(`  every night independent (no level term): brier ${out.level.brierWithout}, margin z2 ${out.level.z2Without}`)
  console.log(`  margin z2 ${out.margin.z2} -> spread x${spreadScale({ replay: out.margin })}`)
  console.log(`  held out: fitted x${out.holdout.scale} on ${out.holdout.fitWeeks} weeks, brier ${out.holdout.brierRaw} -> ${out.holdout.brierScaled} on the other ${out.holdout.testWeeks}`)
  console.log('  wrote public/data/backtest.json')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
