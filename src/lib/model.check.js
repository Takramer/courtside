// Self-check for the fantasy math. Run: npm run check
import assert from 'node:assert/strict'
import { bestLineup, snakePicks, computeValues, evaluateTrade, weekBounds, tagNews, normName, blendLine, DEFAULT_SETTINGS } from './model.js'

// Lineup: a PG/SG star must not block the only pure PG from playing.
const mk = (id, pos) => ({ id, pos })
const { starters, benched } = bestLineup([mk(1, ['PG', 'SG']), mk(2, ['PG']), mk(3, ['C'])], ['PG', 'SG', 'C'])
assert.deepEqual(starters.map((s) => s.player?.id), [2, 1, 3])
assert.equal(benched.length, 0)
// Two centers, one C slot plus a UT: both start.
assert.equal(bestLineup([mk(1, ['C']), mk(2, ['C'])], ['C', 'UT']).benched.length, 0)
// Two centers, one C slot, no UT: the lower one (later in the list) sits.
assert.equal(bestLineup([mk(1, ['C']), mk(2, ['C'])], ['C', 'PG']).benched[0].id, 2)

// Snake draft: slot 3 of 10 picks 3, 18, 23, 38.
assert.deepEqual(snakePicks(10, 3, 4), [3, 18, 23, 38])

// Week runs Monday to Sunday.
assert.deepEqual(weekBounds('2026-10-21'), ['2026-10-19', '2026-10-25'])

// Projection blend: no games played -> pure projection; many games -> mostly real stats.
const line = (pts, gp = 70) => ({ pts, reb: 5, ast: 5, stl: 1, blk: 1, tpm: 2, to: 2, fgm: 8, fga: 17, ftm: 4, fta: 5, min: 32, gp })
assert.equal(blendLine({ proj: line(20) }).pts, 20)
assert.ok(blendLine({ proj: line(20), cur: line(30, 60) }).pts > 27)

// Values: a clearly better player is worth more, and a 1-for-1 swap up is an "accept".
const players = Array.from({ length: 200 }, (_, i) => ({ id: i, pos: ['SF'], inj: 'ACTIVE', stats: { proj: line(30 - i * 0.12) } }))
const v = computeValues(players, { ...DEFAULT_SETTINGS, teams: 10, rosterSize: 10 })
assert.ok(v.get(0).val > v.get(50).val)
assert.ok(Math.abs(v.get([...v.entries()].find(([, x]) => x.rank === 101)[0]).val) < 0.2) // replacement level ~ 0
assert.equal(evaluateTrade([players[50]], [players[0]], v, DEFAULT_SETTINGS).verdict, 'accept')
assert.equal(evaluateTrade([players[0]], [players[50]], v, DEFAULT_SETTINGS).verdict, 'decline')

// News tags and name matching.
assert.ok(tagNews('He will miss Friday due to personal reasons').some((t) => t.k === 'personal'))
assert.ok(tagNews('Will be reevaluated in six weeks after knee surgery').some((t) => t.k === 'longterm'))
assert.ok(!tagNews('Scored 30 in the win').length)
assert.equal(normName('Luka Dončić'), normName('Luka Doncic'))
assert.equal(normName('Jaren Jackson Jr.'), 'jaren jackson')

console.log('model checks pass')
