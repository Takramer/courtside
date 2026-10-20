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

// ---------- predict.js: the week's odds ----------
const P = await import('./predict.js')

// Normal CDF against values you can look up in a table.
assert.ok(Math.abs(P.normalCdf(0) - 0.5) < 1e-9)
assert.ok(Math.abs(P.normalCdf(1.6449) - 0.95) < 1e-3)
assert.ok(Math.abs(P.normalCdf(-1.96) - 0.025) < 1e-3)

// A player who never plays contributes nothing, and no uncertainty either.
assert.deepEqual(P.playerDay({ mean: 40, sd: 12, pPlay: 0 }), { mu: 0, variance: 0 })
// One who always plays is just his own spread.
const sure = P.playerDay({ mean: 40, sd: 12, pPlay: 1 })
assert.ok(Math.abs(sure.mu - 40) < 1e-9 && Math.abs(sure.variance - 144) < 1e-9)
// Missing games costs mean AND adds variance: that is the whole point of carrying pPlay.
const flaky = P.playerDay({ mean: 40, sd: 12, pPlay: 0.5 })
assert.ok(flaky.mu === 20 && flaky.variance > sure.variance)

// Out outranks any history; day-to-day is a coin flip; otherwise availability is the prior.
assert.equal(P.projectPlayer({ espnFp: 40, status: 'out' }).pPlay, 0)
assert.equal(P.projectPlayer({ espnFp: 40, status: 'dtd' }).pPlay, 0.5)
// Last season's absences nudge the chance he plays; they do not set it. A player who missed
// four fifths of last season but is on the floor today is not 20% to suit up tomorrow.
assert.equal(P.projectPlayer({ espnFp: 40, form: { fp_mean: 40, fp_sd: 9, avail: 1 } }).pPlay, 0.92)
const fragile = P.projectPlayer({ espnFp: 40, form: { fp_mean: 40, fp_sd: 9, avail: 0.195 } }).pPlay
assert.ok(fragile > 0.6 && fragile < 0.75, `history nudges, it does not rule: ${fragile}`)
assert.ok(P.projectPlayer({ espnFp: 40, form: { fp_mean: 40, fp_sd: 9, avail: 0.6 } }).pPlay
        > P.projectPlayer({ espnFp: 40, form: { fp_mean: 40, fp_sd: 9, avail: 0.2 } }).pPlay)
// Last season's form is a prior, so it pulls the projection without replacing it.
const blended = P.projectPlayer({ espnFp: 40, form: { fp_mean: 20, fp_sd: 6, g: 70, avail: 0.9 } })
assert.ok(blended.mean > 20 && blended.mean < 40, 'blend sits between ESPN and form')

// Two identical teams are a coin flip, whatever the numbers are.
const even = [{ id: 1, name: 'A', mean: 40, sd: 10, pPlay: 1, games: 4 }]
assert.ok(Math.abs(P.winProbability(P.teamWeek(even), P.teamWeek(even)) - 0.5) < 1e-9)
// More games is an edge on its own, which is the thing managers miss.
const four = P.weekOutlook([{ id: 1, name: 'A', mean: 40, sd: 10, pPlay: 1, games: 4 }],
                           [{ id: 2, name: 'B', mean: 40, sd: 10, pPlay: 1, games: 3 }])
assert.ok(four.pWin > 0.6 && four.gameEdge === 1)
// Losing the best player has to cost more win probability than losing the worst.
const roster = [{ id: 1, name: 'Star', mean: 50, sd: 12, pPlay: 1, games: 4 },
                { id: 2, name: 'Spare', mean: 12, sd: 5, pPlay: 1, games: 4 }]
const hit = P.weekOutlook(roster, [{ id: 3, name: 'C', mean: 45, sd: 12, pPlay: 1, games: 4 }])
assert.equal(hit.swing[0].name, 'Star')
assert.ok(hit.swing[0].cost > hit.swing[1].cost)
// The lineup cap bites: with two slots over one day, a third man's game cannot be started,
// and the starts go to the best players first.
const squeeze = P.teamWeek([{ id: 1, name: 'Best', mean: 50, sd: 10, pPlay: 1, games: 1 },
                            { id: 2, name: 'Good', mean: 30, sd: 8, pPlay: 1, games: 1 },
                            { id: 3, name: 'Bench', mean: 9, sd: 3, pPlay: 1, games: 1 }],
                           { starts: 2, days: 1 })
assert.equal(squeeze.players.find((p) => p.name === 'Bench').games, 0)
assert.equal(squeeze.players.find((p) => p.name === 'Best').games, 1)
assert.ok(Math.abs(squeeze.mu - 80) < 1e-9, 'only the two who start are counted')

// ---------- phase 5: the opponent adjustment ----------
const DVP = { teams: { WAS: { G: { mult: 1.11 }, F: { mult: 1.11 }, C: { mult: 1.1 } },
                       BOS: { G: { mult: 0.93 }, F: { mult: 0.92 }, C: { mult: 0.94 } } } }

// No table, an unknown team, or a player with no position: the projection is left alone.
// A missing adjustment must mean "no change", never "no player".
assert.equal(P.opponentFactor(null, 'BOS', ['PG']), 1)
assert.equal(P.opponentFactor(DVP, 'MEM', ['PG']), 1)
assert.equal(P.opponentFactor(DVP, 'BOS', []), 1)
// ESPN writes WSH and the NBA writes WAS for the same team. Get this wrong and every
// Washington game silently prices at average.
assert.equal(P.opponentFactor(DVP, 'WSH', ['PG']), 1.11)
assert.equal(P.opponentFactor(DVP, 'BOS', ['PG']), 0.93)
// Two positions average, because the defence does not know which one he is listed at.
assert.ok(Math.abs(P.opponentFactor(DVP, 'BOS', ['SG', 'SF']) - 0.925) < 1e-9)

// A week against Washington beats the same week against Boston, and both sit either side of
// the unadjusted number.
const player = (adj) => [{ id: 1, name: 'A', mean: 40, sd: 10, pPlay: 1, games: 2, adj }]
const soft = P.teamWeek(player([1.11, 1.11])).mu
const hard = P.teamWeek(player([0.93, 0.93])).mu
const flat = P.teamWeek(player(null)).mu
assert.ok(Math.abs(flat - 80) < 1e-9, 'no adjustment is the phase 4 answer, unchanged')
assert.ok(soft > flat && flat > hard)
assert.ok(Math.abs(soft - 88.8) < 1e-9, `two nights at 1.11: ${soft}`)
// The spread scales with the mean: a defence that holds a man to 90% holds his ceiling too.
assert.ok(P.teamWeek(player([1.11, 1.11])).sd > P.teamWeek(player([0.93, 0.93])).sd)
// Only the games he actually starts are adjusted, so the cap and the table agree.
assert.equal(P.teamWeek(player([1.11, 1.11]), { starts: 1, days: 1 }).players[0].games, 1)

// matchupEdge is the honest audit: my total with the defences I draw, minus an average week.
const vsWas = P.weekOutlook(player([1.11, 1.11]), player(null))
assert.ok(Math.abs(vsWas.matchupEdge - 8.8) < 0.05, `edge is real points: ${vsWas.matchupEdge}`)
assert.equal(P.weekOutlook(player(null), player(null)).matchupEdge, null, 'no table, no claim')

console.log('predict checks pass')
