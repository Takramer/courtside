// The numbers the spec quotes, in one place: today against v2 on both halves and the whole
// season, a second set of drafts to show it is not the dice, and a few facts the spec leans on.
//     node --no-warnings worker/experiments/05-summary.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, load, buildFrame, price, split, row, pairedWeeks, mean } from './lib.mjs'
import { projectV2, pPlayV2, sigmoid, minutesFirst } from './models.mjs'

const P = JSON.parse(readFileSync(join(HERE, 'params.json')))
const data = load()
for (const seed of [7, 99]) {
  const frame = buildFrame(data, { seed })
  const a = price(frame); const b = price(frame, { project: projectV2(P, P.stack), levelCv: P.levelCv })
  const sa = split(frame, a); const sb = split(frame, b); const d = pairedWeeks(frame, a, b)
  console.log(`\n=== drafts seeded ${seed}`)
  for (const h of ['fit', 'test', 'all']) { console.log(row(`${h.toUpperCase().padEnd(4)} today`, sa[h])); console.log(row(`${h.toUpperCase().padEnd(4)} v2`, sb[h])) }
  console.log(`TEST Brier change ${d.diff} [${d.lo}, ${d.hi}], better in ${Math.round(d.pBetter * 100)}% of week resamples`)
  if (seed === 7) {
    console.log('deciles TEST today:', sa.test.deciles.map((x) => `${x.bin}: said ${x.said} won ${x.won} (${x.n})`).join(' | '))
    console.log('deciles TEST v2   :', sb.test.deciles.map((x) => `${x.bin}: said ${x.said} won ${x.won} (${x.n})`).join(' | '))
    console.log(`typical margin sd, v2: ${mean(b.map((e) => Math.hypot(e.mySd, e.oppSd))).toFixed(0)} points; typical team sd ${mean(b.map((e) => e.mySd)).toFixed(0)}`)
    // The held-out claim, pinned so a later edit to the harness cannot quietly change it.
    assert.ok(sb.test.brier < sa.test.brier - 0.01, 'v2 must beat today on the held-out weeks by more than 0.01 Brier')

    // Same-night residuals: do teammates, or opponents in one game, rise and fall together?
    const res = new Map()
    for (const wk of frame.weeks) for (const c of wk.top.slice(0, 130)) { const p = projectV2(P, P.stack)(c, wk); c.slate.forEach((g, i) => { const r = c.actual.get(g.date); if (!r) return; const k = g.gid; if (!res.has(k)) res.set(k, []); res.get(k).push({ team: c.team, z: (r.fp - p.mean * p.adj[i]) / p.sd }) }) }
    const cor = { same: [0, 0], opp: [0, 0] }
    for (const rs of res.values()) for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const k = rs[i].team === rs[j].team ? 'same' : 'opp'; cor[k][0] += rs[i].z * rs[j].z; cor[k][1]++ }
    console.log(`same-night residual correlation: teammates ${(cor.same[0] / cor.same[1]).toFixed(3)} (${cor.same[1]} pairs), opponents in the same game ${(cor.opp[0] / cor.opp[1]).toFixed(3)} (${cor.opp[1]} pairs)`)
  }
}

console.log('\n=== the play model as a table (weights fitted on the first 11 weeks)')
const wk = { monday: '2026-01-05' }
const day = (d) => ({ date: new Date(Date.parse(wk.monday) + d * 864e5).toISOString().slice(0, 10), b2b: false })
const ok = (missed, avail, d, b2b = false) => pPlayV2({ out: false, missed, form: { avail } }, { ...day(d), b2b }, wk, P).toFixed(3)
const out = (gap, d) => pPlayV2({ out: true, gap }, day(d), wk, P).toFixed(3)
console.log(`healthy, played all of last 3, avail 1.0: day0 ${ok(0, 1, 0)} day3 ${ok(0, 1, 3)} day6 ${ok(0, 1, 6)}; second night of a back-to-back, day3 ${ok(0, 1, 3, true)}`)
console.log(`healthy, avail 0.8: day0 ${ok(0, 0.8, 0)} day6 ${ok(0, 0.8, 6)}`)
console.log(`missed 1 of last 3: day0 ${ok(1, 0.9, 0)} day6 ${ok(1, 0.9, 6)};  missed 2 of last 3: day0 ${ok(2, 0.9, 0)} day6 ${ok(2, 0.9, 6)}`)
console.log(`flagged out, 3 games missed: day0 ${out(3, 0)} day2 ${out(3, 2)} day4 ${out(3, 4)} day6 ${out(3, 6)};  10 missed: day0 ${out(10, 0)} day6 ${out(10, 6)};  30 missed: day0 ${out(30, 0)} day6 ${out(30, 6)}`)
assert.equal(+sigmoid(P.ok[0]).toFixed(3), +ok(0, 1, 0))

console.log('\n=== minutes first, a worked case for the assert')
const h = [20, 20, 20, 20, 30, 30, 30, 30].map((min, i) => ({ min, fp: min * 1.0, date: `2026-01-0${i + 1}` }))
console.log(`eight games, 20 minutes then 30, one point a minute: ${minutesFirst({ h }, { monday: '2026-01-09' }, P.min).toFixed(2)} (plain average 25.00)`)
console.log(`params: ${JSON.stringify(P)}`)

// Reported, not used: does the discount for men coming back hold on the second half too?
{
  const frame = buildFrame(data)
  for (const test of [false, true]) {
    const r = { out: [], ok: [] }
    for (const wk of frame.weeks) { if (frame.isFit(wk.w) === test) continue; for (const c of wk.top.slice(0, 130)) { const m = minutesFirst(c, wk, P.min); c.slate.forEach((g, i) => { const a = c.actual.get(g.date); if (a) r[c.out ? 'out' : 'ok'].push(a.fp / (m * c.dvp[i])) }) } }
    console.log(`${test ? 'TEST' : 'FIT'}: points per game played, against projection: flagged out ${mean(r.out).toFixed(3)} (${r.out.length} games), everyone else ${mean(r.ok).toFixed(3)}`)
  }
}
