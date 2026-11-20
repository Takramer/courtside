// node src/pages/today.check.js — asserts on todayMoves (rankMoves, src/lib/decide.js), the Today
// page's decision list.
import assert from 'node:assert/strict'
import { todayMoves } from './today.js'

const today = '2026-11-19' // a Thursday
const nights = ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
const P = (id, o) => ({ id, name: `P${id} Last${id}`, pos: ['PG'], status: 'ok', longOut: false, val: 10, mean: 40, sd: 10, pPlay: 1, dates: [], adj: null, games: 0, ...o })
const slots = ['UT', 'UT']

// Starter A is out, B has no game; C on the bench plays tonight -> start C over A.
const roster = [
  // irEligible: engine v2 moves only men ESPN flags OUT or IR to an IR slot.
  P(1, { val: 30, status: 'out', pPlay: 0, irEligible: true }),
  P(2, { val: 20, dates: ['2026-11-20'] }),
  P(3, { val: 5, mean: 30, dates: [today] }),
]
let m = todayMoves({ today, nights, slots, rosterSize: 3, roster, irOpen: 0, free: [] })
assert.equal(m[0].kind, 'start')
assert.match(m[0].title, /^Start P3 Last3 over P1 Last1 tonight$/)
assert.equal(m[0].gainPts, 30)
assert.equal(m[0].gainWin, null, 'no odds, no win change')

// Two starters at zero tonight: the one ruled out with a game tonight is named, not the one idle.
m = todayMoves({ today, nights, slots, rosterSize: 3, roster: [roster[1], { ...roster[0], val: 15, dates: [today], play: [0] }, roster[2]], free: [] })
assert.match(m[0].title, /over P1 Last1 tonight$/)
assert.match(m[0].reason, /is out tonight/)

// An IR spot and a free agent who plays the open nights -> IR move carrying the add.
const fa = P(9, { val: 12, dates: ['2026-11-21', '2026-11-22'], games: 2 })
m = todayMoves({ today, nights, slots, rosterSize: 3, roster, irOpen: 1, free: [fa] })
const ir = m.find((x) => x.kind === 'ir')
assert.ok(ir, 'IR move present')
assert.match(ir.title, /Move P1 Last1 to IR, add P9 Last9/)
assert.ok(ir.gainPts > 0)
assert.deepEqual(ir.playerIds, [1, 9])

// With an opponent, every positive move carries a positive win change, and the list is sorted by
// it. v2 prices the win from the rosters themselves, so the opponent is priced players on the
// same scale (a 500-point summary against a 70-point test roster put every move at 0.0000).
const opp = [P(20, { mean: 45, dates: ['2026-11-20', '2026-11-21'], games: 2 })]
m = todayMoves({ today, nights, slots, rosterSize: 3, roster, irOpen: 1, free: [fa], opp })
assert.ok(m.every((x) => x.gainWin > 0))
for (let i = 1; i < m.length; i++) assert.ok(m[i - 1].gainWin >= m[i].gainWin)

// Nothing to do -> one hold row.
m = todayMoves({ today, nights, slots, rosterSize: 2, roster: [P(1, { dates: [today] }), P(2, { dates: [today] })], free: [] })
assert.deepEqual(m.map((x) => x.kind), ['hold'])

console.log('today.check: ok')
