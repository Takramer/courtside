// The week model, with the v2 projection held fixed: is normal-vs-normal good enough?
// Anything fitted here is fitted on the first 11 weeks.
//     node --no-warnings worker/experiments/03-outcome.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, load, buildFrame, price, split, row, pairedWeeks, rng, gauss, mean, metrics } from './lib.mjs'
import { projectV2 } from './models.mjs'

const t0 = Date.now()
const P = JSON.parse(readFileSync(join(HERE, 'params.json')))
const frame = buildFrame(load())
const project = projectV2(P, P.stack)
const v2 = price(frame, { project, levelCv: P.levelCv })
const report = (label, entries, ref = v2) => {
  const s = split(frame, entries); const d = pairedWeeks(frame, ref, entries); const f = pairedWeeks(frame, ref, entries, { test: false })
  console.log(row(`FIT  ${label}`, s.fit) + `  | vs v2 ${f.diff} (${Math.round(f.pBetter * 100)}%)`)
  console.log(row(`TEST ${label}`, s.test) + `  | vs v2 ${d.diff > 0 ? '+' : ''}${d.diff} [${d.lo}, ${d.hi}] (${Math.round(d.pBetter * 100)}%)`)
  return s
}
console.log('--- v2, closed form (the reference)'); report('v2 normal', v2)

// ---- a. skew. The play-or-sit mixture leans left; one Edgeworth term prices that.
console.log('\n--- a. skew-aware closed form')
report('v2 + Edgeworth skew', price(frame, { project, levelCv: P.levelCv, skew: true }))
{
  const g = []
  for (const wk of frame.weeks) { /* how skewed is a team-week, by the model's own account? */ }
  void g
}

// ---- b. absences come in runs. Measure it on FIT: the correlation, inside one man's week,
// between "played less than expected" on two different nights.
console.log('\n--- b. absences in runs')
{
  let num = 0; let den = 0
  for (const wk of frame.weeks) {
    if (!frame.isFit(wk.w)) continue
    for (const c of wk.top.slice(0, 130)) {
      const p = project(c, wk)
      const e = c.slate.map((g, i) => { const q = p.pPlay * (p.pm?.[i] ?? 1); return [(c.actual.has(g.date) ? 1 : 0) - q, Math.sqrt(q * (1 - q))] })
      for (let i = 0; i < e.length; i++) for (let j = i + 1; j < e.length; j++) { num += e[i][0] * e[j][0]; den += e[i][1] * e[j][1] }
    }
  }
  P.rho = +(num / den).toFixed(3)
  console.log(`  measured on FIT: rho = ${P.rho}`)
  let top = null
  for (const cv of [0.1, 0.15, 0.2, 0.25, 0.3]) {
    const e = price(frame, { project, levelCv: cv, rho: P.rho })
    const s = split(frame, e); const f = pairedWeeks(frame, v2, e, { test: false })
    console.log(`  rho ${P.rho}, levelCv ${cv}: FIT logloss ${s.fit.logloss} brier ${s.fit.brier} mz2 ${s.fit.marginZ2} (better than v2 on FIT in ${Math.round(f.pBetter * 100)}%) | TEST brier ${s.test.brier} logloss ${s.test.logloss} mz2 ${s.test.marginZ2}`)
    if (!top || s.fit.logloss < top.v) top = { cv, v: s.fit.logloss }
  }
  report(`rho ${P.rho} + levelCv ${top.cv} (FIT's pick)`, price(frame, { project, levelCv: top.cv, rho: P.rho }))
}

// ---- c. simulation: exact lineups (the ten best who actually suit up), a level draw per man,
// and either bell-curve nights or nights drawn from his own last 25 games.
console.log('\n--- c. simulation, 400 runs a matchup')
const N = 400
const simulate = (empirical) => (m, proj, ta, tb, wk) => {
  const r = rng(m.id)
  const side = (cs) => cs.map((c) => { const p = proj.get(c.pid); const h = c.h.slice(-25).map((x) => x.fp); const hm = mean(h) || 1; return { p, dev: h.map((x) => x / hm) } })
  const A = side(m.a); const B = side(m.b)
  const dates = [...new Set([...m.a, ...m.b].flatMap((c) => c.dates))]
  const total = (S) => {
    let t = 0
    const lv = S.map(() => 1 + P.levelCv * gauss(r))
    for (const d of dates) {
      const on = []
      S.forEach((x, k) => { const i = x.p.dates.indexOf(d); if (i < 0) return; if (r() < x.p.pPlay * (x.p.pm?.[i] ?? 1)) on.push([k, i]) })
      on.sort((a, b) => S[b[0]].p.mean * (S[b[0]].p.adj?.[b[1]] ?? 1) - S[a[0]].p.mean * (S[a[0]].p.adj?.[a[1]] ?? 1))
      for (const [k, i] of on.slice(0, frame.starts)) {
        const x = S[k]; const mu = x.p.mean * (x.p.adj?.[i] ?? 1) * lv[k]
        t += empirical ? mu * x.dev[Math.floor(r() * x.dev.length)] : mu + x.p.sd * (x.p.adj?.[i] ?? 1) * gauss(r)
      }
    }
    return t
  }
  let w = 0
  for (let s = 0; s < N; s++) { const a = total(A); const b = total(B); w += a > b ? 1 : a === b ? 0.5 : 0 }
  return w / N
}
const debias = (entries) => { /* a 400-run estimate adds p(1-p)/N of pure noise to Brier; report it */ return mean(entries.map((e) => e.pWin * (1 - e.pWin) / (N - 1))) }
for (const [label, emp] of [['sim, bell-curve nights', false], ['sim, nights from his own log', true]]) {
  const e = price(frame, { project, levelCv: P.levelCv, pFn: simulate(emp) })
  report(label, e)
  console.log(`  (of that Brier, ${debias(e).toFixed(4)} is the noise of only ${N} runs)`)
}

// ---- d. a spread scale that learns as the season goes, the way grade.js spreadScale does,
// from one league's five matchups a week (what a league-wide ledger would hold).
console.log('\n--- d. spread scale learned from earlier weeks (one league, 5 matchups a week)')
{
  const prior = metrics(v2.filter((e) => frame.isFit(e.wk))).marginZ2 // known once FIT is over
  for (const weight of [40, 15]) {
    const scaleFn = (wk, sofar) => {
      if (frame.isFit(wk.w)) return 1
      const mine = sofar.filter((e) => !frame.isFit(e.wk) && Math.floor((e.id % 10000) / 10) === 0 && !e.tie)
      const z2 = mine.map((e) => ((e.my - e.opp) - (e.myMu - e.oppMu)) ** 2 / (e.mySd ** 2 + e.oppSd ** 2))
      return Math.min(1.6, Math.max(0.8, Math.sqrt((z2.reduce((a, b) => a + b, 0) + weight * prior) / (z2.length + weight))))
    }
    report(`learned scale, prior worth ${weight} matchups`, price(frame, { project, levelCv: P.levelCv, scaleFn }))
  }
  report('fixed scale from FIT margin z2', price(frame, { project, levelCv: P.levelCv, scale: Math.sqrt(prior) }))
}
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
