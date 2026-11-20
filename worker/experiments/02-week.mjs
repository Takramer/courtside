// Each player-level change, priced through the whole week model: alone on top of today's
// engine, then stacked. Parameters come from params.json (fitted on the first 11 weeks by
// 01-player.mjs). The level term is refitted on the first 11 weeks here. TEST is only reported.
//     node --no-warnings worker/experiments/02-week.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, load, buildFrame, price, split, row, pairedWeeks, baseProject } from './lib.mjs'
import { projectV2, fitPlay } from './models.mjs'

const t0 = Date.now()
const P = JSON.parse(readFileSync(join(HERE, 'params.json')))
const frame = buildFrame(load(process.argv[2] || '2025-26'))
const base = price(frame)
const M = P.meanKind
const report = (label, entries) => {
  const s = split(frame, entries)
  const d = pairedWeeks(frame, base, entries)
  console.log(row(`FIT  ${label}`, s.fit))
  console.log(row(`TEST ${label}`, s.test) + `  | vs today: ${d.diff > 0 ? '+' : ''}${d.diff} [${d.lo}, ${d.hi}], better in ${Math.round(d.pBetter * 100)}% of week resamples`)
  return s
}
console.log('--- today'); const s0 = report('baseline', base)
console.log('\n--- one change at a time, on top of today')
const alone = {
  'mean: decayed average': { mean: 'ewma' },
  'mean: minutes first': { mean: 'min' },
  'return discount': { ret: true },
  'back-to-back points': { b2b: true },
  'level calibration': { shrink: true },
  'play model': { play: true },
  'play model, flagged-out half only': { play: 'out' },
  'play model, healthy half only': { play: 'ok' },
  'pooled sd': { sd: true },
  'no defence table': { dvp: false },
  'teammate out (Monday)': { mate: true },
}
const results = {}
for (const [k, on] of Object.entries(alone)) results[k] = report(k, price(frame, { project: projectV2(P, on) }))

console.log('\n--- stacked')
const stack = [['mean', { mean: M }], ['+ b2b', { b2b: true }], ['+ play model', { play: true }], ['+ return discount', { ret: true }], ['+ level calibration (replay only)', { shrink: true }], ['+ pooled sd', { sd: true }]]
let on = {}
for (const [k, add] of stack) { on = { ...on, ...add }; results[`stack ${k}`] = report(k, price(frame, { project: projectV2(P, on) })) }

on = { ...on, sd: false, shrink: false } // neither earned its place; see the rows above
// The play model again, but refitted every Monday on all the weeks before it, the way a
// nightly worker would. Each TEST week is priced with weights that never saw it.
const wf = new Map()
for (const wk of frame.weeks) if (!frame.isFit(wk.w)) wf.set(wk.w, fitPlay(frame.weeks.filter((x) => x.w < wk.w)))
const walk = (flags) => (c, wk) => projectV2(wf.has(wk.w) ? { ...P, ...wf.get(wk.w) } : P, flags)(c, wk)
console.log('\n--- play model refitted each Monday on every earlier week (walk-forward)')
results.walk = report('stack, walk-forward play', price(frame, { project: walk(on) }))
console.log(`  weights going into the last week: ${JSON.stringify(wf.get(frame.weeks.at(-1).w))}`)

console.log('\n--- level term, refitted on FIT with everything stacked')
const stacked = price(frame, { project: projectV2(P, on) })
let top = null
for (const cv of [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4]) {
  const e = price(frame, { project: projectV2(P, on), levelCv: cv })
  const s = split(frame, e)
  const d = pairedWeeks(frame, stacked, e, { test: false })
  console.log(`  levelCv ${cv}: FIT brier ${s.fit.brier} logloss ${s.fit.logloss} mz2 ${s.fit.marginZ2} (vs 0.3 on FIT: ${d.diff}, better in ${Math.round(d.pBetter * 100)}% of resamples) | TEST brier ${s.test.brier} logloss ${s.test.logloss} mz2 ${s.test.marginZ2}`)
  // Move off 0.3 only if FIT says so beyond luck: better in 90% of week resamples.
  if (d.pBetter >= 0.9 && (!top || s.fit.logloss < top.v)) top = { cv, v: s.fit.logloss }
}
P.levelCvFit = top?.cv ?? 0.3
// The brief's rule: a change ships only if it also beats today on the held-out weeks. 0.25
// wins FIT and loses TEST to 0.3, so the level term stays where it is.
P.levelCv = 0.3
P.stack = on
const fin = price(frame, { project: projectV2(P, on), levelCv: P.levelCv })
report(`stack at FIT's levelCv ${P.levelCvFit}`, price(frame, { project: projectV2(P, on), levelCv: P.levelCvFit }))
console.log(`\n--- v2 = stacked (no pooled sd) + levelCv ${P.levelCv}`)
const sv = report('v2', fin)
report('v2, walk-forward play', price(frame, { project: walk(on), levelCv: P.levelCv }))
console.log('deciles TEST today:', s0.test.deciles.map((d) => `${d.bin}:${d.said}/${d.won}(${d.n})`).join(' '))
console.log('deciles TEST v2   :', sv.test.deciles.map((d) => `${d.bin}:${d.said}/${d.won}(${d.n})`).join(' '))
if (!process.argv[2]) writeFileSync(join(HERE, 'params.json'), JSON.stringify(P, null, 1))
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
