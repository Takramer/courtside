// Does ranking moves by the engine's own numbers make real points and real wins?
// Nothing is fitted here. Every matchup's first team gets one add/drop on Monday, chosen four
// ways, and the week is then played out of the real box scores.
//     node --no-warnings worker/experiments/04-decisions.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, load, buildFrame, teamWeekX, winProb, baseProject, mean } from './lib.mjs'
import { projectV2 } from './models.mjs'

const t0 = Date.now()
const P = JSON.parse(readFileSync(join(HERE, 'params.json')))
const frame = buildFrame(load())
const v2 = projectV2(P, P.stack)

// What a side really scores when the manager sets each night's ten by `rank` (his projection).
const actual = (side, rank) => {
  const nights = new Map()
  for (const c of side) for (const [d, r] of c.actual) { if (!nights.has(d)) nights.set(d, []); nights.get(d).push({ fp: r.fp, k: rank(c, d) }) }
  let t = 0
  for (const s of nights.values()) { s.sort((a, b) => b.k - a.k); t += s.slice(0, frame.starts).reduce((n, x) => n + x.fp, 0) }
  return t
}

// ---- 1. lineups: the same rosters, the ten each night picked by today's number or by v2's
{
  const out = { fit: [], test: [] }
  for (const wk of frame.weeks) {
    const pj = new Map(wk.top.map((c) => [c.pid, v2(c, wk)]))
    const rankV2 = (c, d) => { const p = pj.get(c.pid); const i = c.dates.indexOf(d); return p.mean * (p.adj?.[i] ?? 1) }
    for (const m of wk.matchups) for (const side of [m.a, m.b]) out[frame.isFit(wk.w) ? 'fit' : 'test'].push(actual(side, rankV2) - actual(side, (c) => c.base.mean))
  }
  console.log(`lineups set by v2 instead of today's projection: ${mean(out.fit).toFixed(1)} points a team-week on FIT, ${mean(out.test).toFixed(1)} on TEST`)
}

// ---- 2. one add/drop per team per week
const policies = {
  'none': null,
  'naive: mean x games (teamcheck today)': (c) => ({ mean: c.base.mean, sd: c.base.sd, pPlay: c.out ? 0 : 1, adj: null }),
  'today\'s engine, by points': baseProject,
  'v2, by points': v2,
  'v2, by win probability': v2,
}
const res = Object.fromEntries(Object.keys(policies).map((k) => [k, { fit: { pts: [], won: [], pred: [] }, test: { pts: [], won: [], pred: [] } }]))
for (const wk of frame.weeks) {
  const half = frame.isFit(wk.w) ? 'fit' : 'test'
  const cache = new Map()
  const pj = (name, c) => { const key = name + c.pid; if (!cache.has(key)) cache.set(key, { id: c.pid, dates: c.dates, games: c.games, ...policies[name](c, wk) }); return cache.get(key) }
  for (const m of wk.matchups) {
    const before = actual(m.a, (c) => c.base.mean)
    for (const name of Object.keys(policies)) {
      const R = res[name][half]
      if (!policies[name]) { R.pts.push(0); R.won.push(m.my > m.opp ? 1 : 0); continue }
      const tw = (side) => teamWeekX(side.map((c) => pj(name, c)), { starts: frame.starts })
      const base = tw(m.a); const opp = tw(m.b)
      const byWin = name.endsWith('win probability')
      const value = (t) => (byWin ? winProb(t, opp) : t.mu)
      // Candidates: the four men who add least to the week, against the twelve best free agents.
      const drops = [...base.players].sort((x, y) => x.mu - y.mu).slice(0, 4).map((x) => m.a.find((c) => c.pid === x.id))
      const adds = [...m.free].sort((x, y) => { const a = pj(name, x); const b = pj(name, y); return b.mean * b.pPlay * b.games - a.mean * a.pPlay * a.games }).slice(0, 12)
      let top = { v: value(base), side: m.a, dmu: 0 }
      for (const d of drops) for (const a of adds) {
        const side = m.a.map((c) => (c === d ? a : c)); const t = tw(side); const v = value(t)
        if (v > top.v + 1e-9) top = { v, side, dmu: t.mu - base.mu }
      }
      const after = actual(top.side, (c) => c.base.mean)
      R.pts.push(after - before); R.pred.push(top.dmu); R.won.push(after > m.opp ? 1 : 0)
    }
  }
}
for (const half of ['fit', 'test']) {
  console.log(`\n${half.toUpperCase()}: one add/drop for the first team of each matchup`)
  for (const [name, r] of Object.entries(res)) {
    const R = r[half]
    console.log(`  ${name.padEnd(40)} real gain ${mean(R.pts).toFixed(1).padStart(6)} pts  (engine expected ${R.pred.length ? mean(R.pred).toFixed(1) : '  -'})  moves made ${Math.round(100 * R.pts.filter((x) => x !== 0).length / R.pts.length)}%  matchups won ${(100 * mean(R.won)).toFixed(1)}%`)
  }
}
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
