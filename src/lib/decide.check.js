// node src/lib/decide.check.js — asserts on the decision layer (spec, engine v2).
import assert from 'node:assert/strict'
import { rankMoves, streamPlan, tradeCheck } from './decide.js'

const today = '2026-11-19' // Thursday
const nights = ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
const next = ['2026-11-24', '2026-11-26', '2026-11-28']
// A priced player: `on` dates this week at chance `q`, next week's three games at `qn`.
const P = (id, mean, on, q = 0.93, o = {}) => ({
  id, name: `P${id} Last${id}`, pos: ['PG'], status: 'ok', longOut: false, val: mean / 2, mean, sd: mean * 0.3,
  pPlay: q, dates: on, adj: on.map(() => 1), play: on.map(() => q), games: on.length,
  next: { dates: next, adj: next.map(() => 1), play: next.map(() => o.qn ?? 0.9) }, irEligible: false, locked: false, ...o,
})
const three = nights.slice(1)
const A = P(1, 45, three, 0, { status: 'out', longOut: true, qn: 0, val: 30 }) // out for weeks
const B = P(2, 40, three)
const C = P(3, 30, three)
const F = P(9, 35, three) // healthy free agent, 3 games
const opp = [P(21, 45, three), P(22, 40, three), P(23, 35, three)]
const ctx = {
  today, nights, slots: ['UT', 'UT', 'UT'], rosterSize: 3, roster: [A, B, C], irOpen: 0,
  starters: [1, 2, 3], free: [F], opp, banked: [0, 0], weeksLeft: 5,
}

// A healthy free agent with 3 games beats a rostered man who is out all week.
let m = rankMoves(ctx)[0]
assert.equal(m.kind, 'swap')
assert.equal(m.add, 9); assert.equal(m.drop, 1); assert.equal(m.uses, 1)
assert.ok(m.gainPts > 0 && m.gainWin > 0, JSON.stringify(m))
assert.ok(m.gainNext > 0 && m.gainSeason > m.gainWin)
for (const k of ['kind', 'title', 'gainPts', 'gainWin', 'reason', 'playerIds']) assert.ok(k in m, `todayMoves field ${k}`)

// The same move with the limit spent is still listed, and blocked.
m = rankMoves({ ...ctx, acq: { limit: 7, used: 7 } })[0]
assert.equal(m.blocked, 'limit'); assert.match(m.title, /no acquisitions left/)
assert.equal(rankMoves({ ...ctx, acq: { limit: 7, used: 6 } })[0].blocked, null)

// A decided week ranks by next week: gainWin about 0, gainSeason above 0.
m = rankMoves({ ...ctx, banked: [0, 3000] })[0]
assert.ok(Math.abs(m.gainWin) < 1e-3 && m.gainSeason > 0, JSON.stringify(m))

// A locked man is never dropped.
const lockedA = { ...A, locked: true }
const ms = rankMoves({ ...ctx, roster: [lockedA, B, C] })
assert.ok(ms.every((x) => x.drop !== 1), JSON.stringify(ms))
assert.equal(ms[0].drop, 3) // the next weakest goes instead

// A man out this week but not long-term is not swapped for a lesser player.
assert.ok(rankMoves({ ...ctx, roster: [{ ...A, longOut: false }, B, C] }).every((x) => x.drop !== 1))

// Nor is a better healthy man who just has fewer games this week; the weakest by val streams.
const G = P(6, 44, [nights[3]], 0.93, { val: 22 })
assert.ok(rankMoves({ ...ctx, opp: null, roster: [B, C, G] }).every((x) => x.drop !== 6)) // no opp: the UI unlinked

// No opponent: no win numbers, ranked by points.
m = rankMoves({ ...ctx, opp: null })[0]
assert.equal(m.gainWin, null); assert.equal(m.gainSeason, null); assert.equal(m.kind, 'swap')

// IR: an eligible man goes to the open spot with the best free agent; an IR man who is
// healthy again is listed first, whatever it is worth.
m = rankMoves({ ...ctx, roster: [{ ...A, irEligible: true }, B, C], irOpen: 1 })[0]
assert.equal(m.kind, 'ir'); assert.deepEqual(m.playerIds, [1, 9])
m = rankMoves({ ...ctx, ir: [P(5, 20, three)] })[0]
assert.equal(m.kind, 'activate'); assert.equal(m.uses, 0)

// Nothing to do: one hold row.
const ms2 = rankMoves({ ...ctx, roster: [B, C, P(4, 38, three)], free: [P(10, 5, three)] })
assert.deepEqual(ms2.map((x) => x.kind), ['hold'])

// Trades. priceWeek gives every man three games that week; the caller owns the schedule.
const weeks = [{ start: '2026-11-23' }, { start: '2026-11-30' }]
const priceWeek = (ps) => ps.map((p) => ({ ...p, dates: ['a', 'b', 'c'], adj: null }))
const big = P(2, 50, three)
const tctx = { ...ctx, roster: [{ ...A, val: 1 }, big, C], weeks, priceWeek, oppFor: () => opp }
const t1 = tradeCheck(tctx, { give: [2], get: [P(30, 30, three)] })
assert.ok(t1.deltaWins < 0 && t1.verdict === 'decline', JSON.stringify(t1))
assert.ok(t1.assumes.some((s) => /P1 Last1 is out long-term/.test(s))) // A is priced at 0 ahead
// 2-for-1 fills the open spot with the best free agent.
const t2 = tradeCheck(tctx, { give: [2, 3], get: [P(31, 60, three)] })
assert.equal(t2.alsoAdd.length, 1); assert.deepEqual(t2.alsoAdd, [9]); assert.equal(t2.alsoDrop.length, 0)
// 1-for-2 drops the lowest-value man not in the trade.
const t3 = tradeCheck(tctx, { give: [3], get: [P(32, 30, three), P(33, 28, three)] })
assert.deepEqual(t3.alsoDrop, [1])

// streamPlan never has more steps than acquisitions left; unlimited is one step a night.
// The spot churned is the healthy man worth least next week (D), not the injured one.
const streamers = nights.map((d, k) => P(40 + k, 40, [d]))
const D = P(4, 8, three)
const sctx = { ...ctx, roster: [B, C, D], free: streamers }
const open = streamPlan(sctx)
assert.ok(open.steps.length >= 2 && open.left === null, JSON.stringify(open))
assert.equal(open.steps[0].drop, 4)
assert.equal(new Set(open.steps.map((s) => s.date)).size, open.steps.length)
assert.ok(open.gainPts > 0 && open.gainWin > 0)
const one = streamPlan({ ...sctx, acq: { limit: 3, used: 2 } })
assert.ok(one.steps.length <= 1 && one.left === 0, JSON.stringify(one))
assert.equal(streamPlan({ ...sctx, acq: { limit: 3, used: 3 } }).steps.length, 0)

console.log('decide.check: ok')

// An add into an open spot names the nights it fills (QA: "Add X" read as a season upgrade).
m = rankMoves({ ...ctx, rosterSize: 3, roster: [B, C], starters: [2, 3], free: [P(10, 20, three)] }).find((x) => x.kind === 'add')
assert.equal(m.reason, 'fills your open Fri, Sat and Sun slots', JSON.stringify(m))
