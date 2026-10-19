// Self-check for the fantasy math. Run: npm run check
import assert from 'node:assert/strict'
import { bestLineup, snakePicks, computeValues, evaluateTrade, weekBounds, tagNews, normName, blendLine, DEFAULT_SETTINGS,
  likelyGone, positionOutlook, draftSuggestions, positionRun } from './model.js'

// Lineup: a PG/SG star must not block the only pure PG from playing.
const mk = (id, pos) => ({ id, pos })
const { starters, benched } = bestLineup([mk(1, ['PG', 'SG']), mk(2, ['PG']), mk(3, ['C'])], ['PG', 'SG', 'C'])
assert.deepEqual(starters.map((s) => s.player?.id), [2, 1, 3])
assert.equal(benched.length, 0)
// Two centers, one C slot plus a UT: both start.
assert.equal(bestLineup([mk(1, ['C']), mk(2, ['C'])], ['C', 'UT']).benched.length, 0)
// Two centers, one C slot, no UT: the lower one (later in the list) sits.
assert.equal(bestLineup([mk(1, ['C']), mk(2, ['C'])], ['C', 'PG']).benched[0].id, 2)
// PF/C takes either a power forward or a centre, and nobody else
assert.equal(bestLineup([mk(1, ['C']), mk(2, ['PF']), mk(3, ['PG'])], ['PF/C']).benched.map((x) => x.id).join(), '2,3')
assert.equal(bestLineup([mk(1, ['SG'])], ['PF/C']).benched.length, 1)

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

// Draft: ADP order predicts who goes first. With one good C left and him due to go before my following pick,
// C reads "take now" and he outranks a slightly better SF who will still be there.
const dp = [
  { id: 'sf1', pos: ['SF'], adp: 10, val: 20 }, { id: 'sf2', pos: ['SF'], adp: 40, val: 19.5 },
  { id: 'c1', pos: ['C'], adp: 12, val: 18 }, { id: 'c2', pos: ['C'], adp: 90, val: 8 },
].map((p) => ({ ...p, inj: 'ACTIVE' }))
const dv = new Map(dp.map((p) => [p.id, { seasonVal: p.val, z: {} }]))
const pts = { ...DEFAULT_SETTINGS, format: 'points' }
assert.deepEqual(likelyGone(dp, 2).map((p) => p.id), ['sf1', 'c1'])
const later = likelyGone(dp, 2)
const out = positionOutlook({ available: dp, mine: [], values: dv, settings: pts, gone: [], goneLater: later })
assert.equal(out.find((o) => o.pos === 'C').level, 'now')
assert.equal(out.find((o) => o.pos === 'SF').level, 'wait')
// Every position dropping (round 1): only the steepest drops read "take now", the rest "soon".
const dp2 = [...dp, { id: 'sf3', pos: ['SF'], adp: 95, val: 17, inj: 'ACTIVE' }]
const dv2 = new Map([...dv, ['sf3', { seasonVal: 17, z: {} }]])
const early = positionOutlook({ available: dp2, mine: [], values: dv2, settings: pts, gone: [], goneLater: likelyGone(dp2, 3) })
assert.equal(early.find((o) => o.pos === 'C').level, 'now')
assert.equal(early.find((o) => o.pos === 'SF').level, 'soon')
assert.equal(draftSuggestions({ available: dp, mine: [], values: dv, settings: pts, nextPick: 5, followingPick: 16, goneLater: later })[0].p.id, 'c1')
// Not on the clock: players expected to go first drop out of the suggestions.
assert.ok(!draftSuggestions({ available: dp, mine: [], values: dv, settings: pts, gone: [dp[0]] }).some((s) => s.p.id === 'sf1'))
assert.equal(positionRun([['C'], ['C'], ['PG'], ['C']].map((pos) => ({ pos }))).pos, 'C')
assert.equal(positionRun([['C'], ['PG'], ['SF'], ['SG']].map((pos) => ({ pos }))), null)

// News tags and name matching.
assert.ok(tagNews('He will miss Friday due to personal reasons').some((t) => t.k === 'personal'))
assert.ok(tagNews('Will be reevaluated in six weeks after knee surgery').some((t) => t.k === 'longterm'))
assert.ok(!tagNews('Scored 30 in the win').length)
assert.equal(normName('Luka Dončić'), normName('Luka Doncic'))
assert.equal(normName('Jaren Jackson Jr.'), 'jaren jackson')

console.log('model checks pass')
