// Fit the player-level pieces on the FIRST 11 weeks only, write params.json, and print what
// each piece does to player-game error on both halves. The second half is printed, never used.
//     node --no-warnings worker/experiments/01-player.mjs
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, load, buildFrame, playerScore, baseProject, mean } from './lib.mjs'
import { ewmaMean, minutesFirst, projectV2, expectedMiss, fitPlay } from './models.mjs'

const t0 = Date.now()
const frame = buildFrame(load())
const FIT = { test: false }
const TEST = { test: true }
const fitWeeks = frame.weeks.filter((w) => frame.isFit(w.w))
const P = {}
const show = (label, project) => {
  const a = playerScore(frame, project, FIT); const b = playerScore(frame, project, TEST)
  console.log(`${label.padEnd(44)} FIT rmse ${a.rmse} bias ${a.bias} playBrier ${a.playBrier} ev ${a.evBias} | TEST rmse ${b.rmse} bias ${b.bias} playBrier ${b.playBrier} ev ${b.evBias}`)
}
const best = (label, grid, make) => {
  let top = null
  for (const g of grid) { const s = playerScore(frame, make(g), FIT).rmse; if (!top || s < top.s) top = { g, s } }
  console.log(`  ${label}: best on FIT ${JSON.stringify(top.g)} rmse ${top.s}`)
  return top.g
}
const withMean = (f) => (c, wk) => ({ ...c.base, mean: f(c, wk), adj: c.dvp })
show('baseline (last 25, as today)', baseProject)

// ---- 1. the average: window, decay, shrink
const mu0 = +mean(fitWeeks.flatMap((w) => w.top.slice(0, 130).map((c) => c.base.mean))).toFixed(1)
for (const n of [10, 15, 40, 999]) show(`last ${n} games`, withMean((c) => mean(c.h.slice(-n).map((r) => r.fp))))
const grid1 = []
for (const hl of [6, 10, 15, 25, 40, 80]) for (const K of [0, 1, 2, 4, 8]) grid1.push({ hl, K, mu0 })
P.ewma = best('ewma by games', grid1, (g) => withMean((c, wk) => ewmaMean(c, wk, g)))
show(`ewma hl ${P.ewma.hl} games, K ${P.ewma.K} to ${mu0}`, withMean((c, wk) => ewmaMean(c, wk, P.ewma)))
const grid1d = []
for (const hlDays of [14, 21, 30, 45, 60, 90]) for (const K of [0, 1, 2, 4]) grid1d.push({ hlDays, K, mu0 })
const byDays = best('ewma by days', grid1d, (g) => withMean((c, wk) => ewmaMean(c, wk, g)))
show(`ewma hl ${byDays.hlDays} days, K ${byDays.K}`, withMean((c, wk) => ewmaMean(c, wk, byDays)))

// ---- 2. minutes first
const r0 = +(fitWeeks.flatMap((w) => w.top.slice(0, 130)).reduce((n, c) => n + c.h.reduce((a, r) => a + r.fp, 0), 0)
  / fitWeeks.flatMap((w) => w.top.slice(0, 130)).reduce((n, c) => n + c.h.reduce((a, r) => a + r.min, 0), 0)).toFixed(3)
const grid2 = []
for (const hlM of [3, 5, 8, 12, 20]) for (const hlR of [15, 25, 40, 80, 9999]) for (const Kmin of [0, 100, 300]) for (const K of [0, 2]) grid2.push({ hlM, hlR, Kmin, r0, K, mu0 })
P.min = best('minutes first', grid2, (g) => withMean((c, wk) => minutesFirst(c, wk, g)))
show(`minutes first ${JSON.stringify(P.min)}`, withMean((c, wk) => minutesFirst(c, wk, P.min)))
// minutes alone: how well does each window predict minutes?
for (const hlM of [3, 8, 20]) {
  let ae = 0; let n = 0
  for (const wk of fitWeeks) for (const c of wk.top.slice(0, 130)) { const m = minutesFirst(c, wk, { hlM, hlR: 1 }) ; void m; const w = c.h.map((r, i) => 0.5 ** ((c.h.length - 1 - i) / hlM)); const pm = c.h.reduce((a, r, i) => a + w[i] * r.min, 0) / w.reduce((a, b) => a + b, 0); for (const r of c.actual.values()) { ae += Math.abs(r.min - pm); n++ } }
  console.log(`  minutes MAE on FIT, half-life ${hlM} games: ${(ae / n).toFixed(2)}`)
}

// ---- 3. which average: whichever has the lower error on FIT
const meanKind = playerScore(frame, withMean((c, wk) => minutesFirst(c, wk, P.min)), FIT).rmse < playerScore(frame, withMean((c, wk) => ewmaMean(c, wk, P.ewma)), FIT).rmse ? 'min' : 'ewma'
P.meanKind = meanKind
const mfn = (c, wk) => (meanKind === 'min' ? minutesFirst(c, wk, P.min) : ewmaMean(c, wk, P.ewma))
const ratios = (keyFn) => {
  const b = {}
  for (const wk of fitWeeks) for (const c of wk.top.slice(0, 130)) { const m = mfn(c, wk); c.slate.forEach((g, i) => { const a = c.actual.get(g.date); const k = keyFn(c, g); if (a && k != null) (b[k] ??= []).push(a.fp / (m * c.dvp[i])) }) }
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [+mean(v).toFixed(3), v.length]]))
}

// ---- 4. men coming back, and back-to-backs: one ratio each, from FIT residuals
{
  const r = ratios((c) => (c.out ? 'out' : `m${c.missed}`))
  P.ret = { out: +(r.out[0] / r.m0[0]).toFixed(3) } // m1 and m2 come out at 1.00: no discount
  console.log(`  points when he does play, by Monday status, FIT: ${JSON.stringify(r)} -> ${JSON.stringify(P.ret)}`)
  const b = ratios((c, g) => (g.b2b ? 'b' : 'n'))
  P.b2b = +(b.b[0] / b.n[0]).toFixed(3)
  console.log(`  back-to-back points ratio on FIT: ${P.b2b} (${b.b[1]} games)`)
  const h = ratios((c, g) => (g.home ? 'home' : 'away'))
  console.log(`  home/away on FIT: ${JSON.stringify(h)}`)
  const e = ratios((c, g) => (g.exp >= 8 ? 'fav8' : g.exp <= -8 ? 'dog8' : 'mid'))
  console.log(`  expected margin on FIT: ${JSON.stringify(e)}`)
}

// ---- 4b. calibration of the average itself: regress what he scored on what was projected
// (FIT, games played). A slope under 1 is regression to the mean; an intercept is a level shift.
{
  const xs = []; const ys = []
  const pj = projectV2({ ...P, shrink: { k: 1, mu0: 0 } }, { mean: meanKind, b2b: true, ret: true })
  for (const wk of fitWeeks) for (const c of wk.top.slice(0, 130)) { const p = pj(c, wk); c.slate.forEach((g, i) => { const a = c.actual.get(g.date); if (a) { xs.push(p.mean * p.adj[i]); ys.push(a.fp) } }) }
  const mx = mean(xs); const my = mean(ys)
  const b = xs.reduce((n, x, i) => n + (x - mx) * (ys[i] - my), 0) / xs.reduce((n, x) => n + (x - mx) ** 2, 0)
  const a = my - b * mx
  P.shrink = { k: +b.toFixed(3), mu0: +(a / (1 - b)).toFixed(1) }
  console.log(`  calibration on FIT: actual = ${a.toFixed(2)} + ${b.toFixed(3)} x projected  ->  shrink ${JSON.stringify(P.shrink)}; mean ratio actual/projected ${(my / mx).toFixed(3)}`)
}

// ---- 5. chance of playing: logistic, fitted by gradient descent on FIT
{
  const f = fitPlay(fitWeeks)
  P.ok = f.ok; P.out = f.out
  console.log(`  pPlay healthy [1, missed1, missed2, 1-avail, day, b2b] = ${JSON.stringify(P.ok)} on ${f.n[0]}`)
  console.log(`  pPlay flagged out [1, day, log gap] = ${JSON.stringify(P.out)} on ${f.n[1]}`)
}

// ---- 5b. league-wide drift in availability, from the 21 days before each Monday
{
  P.trail = { ref: +mean(fitWeeks.map((w) => w.availIdx)).toFixed(4), k: 0 }
  console.log(`  availability index by week: ${frame.weeks.map((w) => `${w.w}:${w.availIdx.toFixed(3)}`).join(' ')}`)
  let top = null
  for (const k of [0, 0.5, 1, 1.5, 2]) { const s = playerScore(frame, projectV2({ ...P, trail: { ...P.trail, k } }, { play: true }), FIT).playBrier; console.log(`  drift weight ${k}: FIT playBrier ${s}`); if (!top || s < top.s - 0.0002) top = { k, s } }
  P.trail.k = top.k
}

// ---- 6. teammate out: (actual / projected - 1) against the change in missing rotation minutes
{
  let sxy = 0; let sxx = 0; let n = 0; let oxy = 0; let oxx = 0
  for (const wk of fitWeeks) for (const c of wk.top.slice(0, 130)) {
    const m = mfn(c, wk); const usual = mean(c.h.slice(-25).map((r) => r.miss)); const d = expectedMiss(c, wk, P) - usual
    c.slate.forEach((g, i) => { const a = c.actual.get(g.date); if (!a) return; const res = a.fp / (m * c.dvp[i]) - 1; sxy += d * res; sxx += d * d; n++; const od = g.miss - usual; oxy += od * res; oxx += od * od })
  }
  P.mate = { beta: +(sxy / sxx).toFixed(5), cap: 0.15 }
  P.mateOracle = +(oxy / oxx).toFixed(5)
  console.log(`  teammate-out slope on FIT: ${P.mate.beta} per missing minute known on Monday; ${P.mateOracle} when that night's absences are known (${n} games)`)
}

// ---- 7. the spread: his own sd against a pooled one that rises with the average
{
  const xs = []; const ys = []
  for (const wk of fitWeeks) for (const c of wk.top.slice(0, 130)) { xs.push(c.base.mean); ys.push(c.base.sd) }
  const mx = mean(xs); const my = mean(ys)
  const b = xs.reduce((n, x, i) => n + (x - mx) * (ys[i] - my), 0) / xs.reduce((n, x) => n + (x - mx) ** 2, 0)
  P.sd = { a: +(my - b * mx).toFixed(2), b: +b.toFixed(3), w: 1 }
  const nll = (w) => { let s = 0; let n = 0; for (const wk of fitWeeks) for (const c of wk.top.slice(0, 130)) { const m = mfn(c, wk); const sd = Math.sqrt(w * c.base.sd ** 2 + (1 - w) * (P.sd.a + P.sd.b * m) ** 2); c.slate.forEach((g, i) => { const a = c.actual.get(g.date); if (a) { s += Math.log(sd) + 0.5 * ((a.fp - m * c.dvp[i]) / sd) ** 2; n++ } }) } return s / n }
  let top = null
  for (const w of [1, 0.75, 0.5, 0.25, 0]) { const v = nll(w); console.log(`  sd weight on own ${w}: nll ${v.toFixed(4)}`); if (!top || v < top.v) top = { w, v } }
  P.sd.w = top.w
  console.log(`  pooled sd = ${P.sd.a} + ${P.sd.b} x mean; weight on own sd ${P.sd.w}`)
}

console.log()
const M = { mean: meanKind }
show('v2 mean only', projectV2(P, M))
show('  + b2b', projectV2(P, { ...M, b2b: true }))
show('  + play model + return discount', projectV2(P, { ...M, b2b: true, play: true, ret: true }))
show('  + teammate out, known Monday', projectV2(P, { ...M, b2b: true, play: true, ret: true, mate: true }))
show('  + teammate out, known that night', projectV2(P, { ...M, b2b: true, play: true, ret: true, mate: 'oracle' }))
show('  + level calibration (rejected)', projectV2(P, { ...M, b2b: true, play: true, ret: true, shrink: true }))
show('today + play model only', projectV2(P, { play: true }))
writeFileSync(join(HERE, 'params.json'), JSON.stringify(P, null, 1))
console.log(`\nwrote params.json (fitted on weeks before ${frame.mid}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
