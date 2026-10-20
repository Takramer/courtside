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

// Night by night, the cap bites only where it should. Same three men: all on one night and
// the third sits; spread over three nights and all three count.
const trio = (dates) => [{ id: 1, name: 'Best', mean: 50, sd: 10, pPlay: 1, games: 1, dates: [dates[0]] },
                         { id: 2, name: 'Good', mean: 30, sd: 8, pPlay: 1, games: 1, dates: [dates[1]] },
                         { id: 3, name: 'Bench', mean: 9, sd: 3, pPlay: 1, games: 1, dates: [dates[2]] }]
const busy = P.teamWeek(trio(['mon', 'mon', 'mon']), { starts: 2 })
assert.ok(Math.abs(busy.mu - 80) < 1e-9 && busy.players.find((p) => p.name === 'Bench').games === 0)
assert.ok(Math.abs(P.teamWeek(trio(['mon', 'tue', 'wed']), { starts: 2 }).mu - 89) < 1e-9, 'a quiet night starts everyone')
// The man behind a doubtful starter is his cover: two coin flips in front of him leave a whole slot.
const cover = P.teamWeek(trio(['mon', 'mon', 'mon']).map((p) => (p.id < 3 ? { ...p, pPlay: 0.5 } : p)), { starts: 2 })
assert.ok(Math.abs(cover.players.find((p) => p.name === 'Bench').mu - 9) < 1e-9)
// Points already scored move the total and add no doubt: they happened.
const bank = P.teamWeek(trio(['mon', 'tue', 'wed']), { starts: 2, banked: 400 })
assert.ok(Math.abs(bank.mu - 489) < 1e-9 && bank.sd === P.teamWeek(trio(['mon', 'tue', 'wed']), { starts: 2 }).sd)
// So a big Thursday lead wins the week even against a better remaining roster.
const ahead = P.weekOutlook(trio(['mon', 'tue', 'wed']), trio(['mon', 'tue', 'wed']).map((p) => ({ ...p, mean: p.mean * 1.5 })),
  { starts: 2, banked: [300, 0] })
assert.ok(ahead.pWin > 0.9 && ahead.me.mu > ahead.opp.mu, `a 300-point lead is not a coin flip: ${ahead.pWin}`)
// A man's nights move together, so the level term widens the week and leaves its middle alone.
const lone = [{ id: 1, name: 'A', mean: 40, sd: 10, pPlay: 1, games: 4 }]
assert.equal(P.teamWeek(lone, { levelCv: 0 }).mu, P.teamWeek(lone).mu)
assert.ok(P.teamWeek(lone).sd > P.teamWeek(lone, { levelCv: 0 }).sd)
assert.ok(Math.abs(P.teamWeek(lone, { levelCv: 0 }).variance - 400) < 1e-9, 'with it off, four independent nights')
// Widening the spread pulls a favourite back towards a coin, and never past it.
const fav = [P.teamWeek(lone), P.teamWeek([{ ...lone[0], mean: 30 }])]
assert.ok(P.winProbability(...fav, 1.5) < P.winProbability(...fav) && P.winProbability(...fav, 1.5) > 0.5)

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

// ---------- phase 6: who guards him, and who he has history with ----------
const MU = {
  season: '2025-26', min_poss: 30, top_n: 8,
  names: { 1: 'Nikola Jokić', 10: 'Rudy Gobert', 11: 'Alperen Sengun', 12: 'Retired Man' },
  by_norm: { 'nikola jokic': 1 },
  now: { 10: 'MIN', 11: 'HOU' }, // 12 has no team: out of the league
  scorers: { 1: [
    { d: 10, gp: 4, poss: 95.1, pts100: 35.8, fga: 30, fg: 0.68, tov: 2 },
    { d: 11, gp: 5, poss: 109.1, pts100: 42.2, fga: 40, fg: 0.56, tov: 3 },
    { d: 12, gp: 3, poss: 120, pts100: 20, fga: 8, fg: null, tov: 1 },
  ] },
}

// ESPN writes Jokic, the NBA writes Jokić. Get this wrong and the best players in the
// league silently have no matchup history at all.
assert.equal(P.defenderHistory(MU, 'Nikola Jokic').length, 3)
// Nothing to say is an empty list, never a crash and never a fabricated row.
assert.deepEqual(P.defenderHistory(null, 'Nikola Jokic'), [])
assert.deepEqual(P.defenderHistory(MU, 'Someone Else'), [])

// Most-guarded first when no week is given.
assert.equal(P.defenderHistory(MU, 'Nikola Jokic')[0].name, 'Retired Man')
// Given the week, the men he actually meets come first, whatever the possession count.
const wk = P.defenderHistory(MU, 'Nikola Jokic', ['MIN'])
assert.equal(wk[0].name, 'Rudy Gobert')
assert.ok(wk[0].thisWeek && !wk[1].thisWeek)
// ESPN spells six teams differently. A Washington or Golden State week must still match.
const espnWeek = P.defenderHistory({ ...MU, now: { 10: 'WAS' } }, 'Nikola Jokic', ['WSH'])
assert.ok(espnWeek[0].thisWeek, 'ESPN WSH has to find NBA WAS')
// A defender out of the league is carried, but never marked as this week's problem.
assert.equal(P.defenderHistory(MU, 'Nikola Jokic', ['MIN']).find((r) => r.id === 12).team, null)
// Under ten attempts the percentage is withheld rather than printed as zero.
assert.equal(P.defenderHistory(MU, 'Nikola Jokic').find((r) => r.id === 12).fg, null)

// Friction: both men are named, so the lookup works from either end, and the other one
// is who comes back.
const FR = { season: '2025-26', pairs: [
  { a: 1, a_name: 'Nikola Jokić', b: 2, b_name: 'Draymond Green', n: 2, kinds: { flagrant: 1, 'double technical': 1 }, last: '2026-03-04' },
  { a: 3, a_name: 'Somebody', b: 4, b_name: 'Another', n: 1, kinds: { flagrant: 1 }, last: '2026-01-01' },
] }
assert.deepEqual(P.frictionFor(FR, 'Nikola Jokic').map((r) => r.name), ['Draymond Green'])
assert.deepEqual(P.frictionFor(FR, 'Draymond Green').map((r) => r.name), ['Nikola Jokić'])
assert.deepEqual(P.frictionFor(FR, 'Nobody'), [])
assert.deepEqual(P.frictionFor(null, 'Nikola Jokic'), [])
// Repeat offenders first: once is an accident, twice is the thing worth reading.
assert.equal(P.frictionFor({ pairs: [...FR.pairs, { a: 1, a_name: 'Nikola Jokić', b: 9, b_name: 'Once Only', n: 1, kinds: { flagrant: 1 }, last: '2026-02-01' }] }, 'Nikola Jokic')[0].n, 2)

console.log('matchup and friction checks pass')

// ---------- phase 7: what the feed is allowed to do to p_play ----------
const NOW = Date.parse('2026-10-19T12:00:00Z')
const item = (title, hoursAgo, tags, src = 'RotoWire') =>
  ({ title, src, date: new Date(NOW - hoursAgo * 3600e3).toISOString(), tags: tags.map((k) => ({ k })) })

// ESPN's own flags are the top of the tree and are never talked out of it.
assert.equal(P.availability({ inj: 'OUT' }).status, 'out')
assert.equal(P.availability({ inj: 'SUSPENSION' }).why, 'Suspended')
assert.equal(P.availability({ inj: 'INJURY_RESERVE' }).status, 'out')
assert.equal(P.availability({ inj: 'DAY_TO_DAY' }).status, 'dtd')
assert.equal(P.availability({ inj: 'ACTIVE' }).status, 'ok')
assert.equal(P.availability().status, 'ok', 'no information is not bad information')

// The injury report sits below the flag and above the news.
assert.equal(P.availability({ report: { status: 'Out', comment: 'Left knee' } }).why, 'Left knee')
assert.equal(P.availability({ report: { status: 'Day-To-Day' } }).status, 'dtd')

// News is routinely hours ahead of both, which is the point of reading it.
const ruledOut = P.availability({ news: [item('Ruled out Thursday', 3, ['out'])], now: NOW })
assert.equal(ruledOut.status, 'out')
assert.equal(ruledOut.source, 'RotoWire')
// A suspension is a stated number of games, so it prices exactly like an injury.
assert.equal(P.availability({ news: [item('Suspended five games', 5, ['suspended'])], now: NOW }).status, 'out')
// Stale news does not keep benching him: last Tuesday's "ruled out" is about last Tuesday.
assert.equal(P.availability({ news: [item('Ruled out', 80, ['out'])], now: NOW }).status, 'ok')
// "Returns from suspension Friday" carries the word that would otherwise bench him. The
// return is the newer fact and has to win, or every comeback reads as an absence.
assert.equal(P.availability({ news: [item('Returns from suspension Friday', 2, ['suspended', 'roleup'])], now: NOW }).status, 'ok')
assert.equal(P.availability({ news: [item('Questionable, sore knee', 2, ['questionable'])], now: NOW }).status, 'dtd')

// The whole point of the split: off-court events are surfaced and priced at nothing.
const legal = P.availability({ news: [item('Arrested on Saturday', 20, ['legal'], 'ESPN')], now: NOW })
assert.equal(legal.status, 'ok', 'an arrest is not a lineup decision and must not be priced as one')
assert.equal(legal.flags.length, 1)
assert.equal(legal.flags[0].tag, 'legal')
const personal = P.availability({ news: [item('Away from the team, family matter', 48, ['personal'])], now: NOW })
assert.equal(personal.status, 'ok')
assert.equal(personal.flags[0].tag, 'personal')
// Flags have a longer memory than priced news — a court date from Monday still matters on
// Friday, while Monday's "ruled out" does not.
assert.equal(P.availability({ news: [item('Court date set', 24 * 6, ['legal'])], now: NOW }).flags.length, 1)
assert.equal(P.availability({ news: [item('Court date set', 24 * 9, ['legal'])], now: NOW }).flags.length, 0)
// Out and flagged at once: the injury prices, the arrest is still shown.
const both = P.availability({ inj: 'OUT', news: [item('Arrested', 10, ['legal'])], now: NOW })
assert.equal(both.status, 'out')
assert.equal(both.flags.length, 1)
// An item with no date cannot be dated, so it is neither priced nor flagged.
assert.equal(P.availability({ news: [{ title: 'Ruled out', tags: [{ k: 'out' }] }], now: NOW }).status, 'ok')

// End to end: the resolver's answer is what projectPlayer turns into a chance of playing.
assert.equal(P.projectPlayer({ espnFp: 40, status: P.availability({ inj: 'OUT' }).status }).pPlay, 0)
assert.equal(P.projectPlayer({ espnFp: 40, status: legal.status, form: { fp_mean: 40, fp_sd: 9, avail: 1 } }).pPlay, 0.92)

console.log('event feed checks pass')

// ---------- phase 8: grading the model ----------
const G = await import('./grade.js')

// The forecast is written once. Opening the app again on Thursday must not quietly replace
// Monday's claim with a better-informed one — that is how a model marks its own homework.
let led = G.recordWeek({}, { week: 3, pWin: 0.6, myMu: 1400, mySd: 150, daysLeft: 7 })
led = G.recordWeek(led, { week: 3, pWin: 0.9, myMu: 1500, mySd: 120, daysLeft: 4 })
assert.equal(led['3'].pWin, 0.6, 'the first snapshot is the prediction')
assert.ok(led['3'].saved)
assert.deepEqual(G.recordWeek({}, { pWin: 0.6 }), {}, 'no week number, nothing recorded')

// Settling attaches the result and leaves the claim alone.
led = G.settle(led, [{ week: 3, my: 1480, opp: 1390 }])
assert.equal(led['3'].final.won, true)
assert.equal(led['3'].pWin, 0.6)
assert.deepEqual(G.settle(led, [{ week: 3, my: 1480, opp: 1390 }])['3'], led['3'], 'settling twice changes nothing')
assert.equal(G.settle(led, [{ week: 9, my: 1, opp: 2 }])['9'], undefined, 'a result with no forecast is not a grade')
assert.equal(G.settle(led, [{ week: 3, my: null, opp: 1 }])['3'].final.my, 1480, 'a half-finished week does not overwrite')

// A week in progress is not graded.
const open = G.score(G.recordWeek({}, { week: 1, pWin: 0.6, myMu: 1400, mySd: 150, daysLeft: 7 }))
assert.equal(open.graded, 0)
assert.equal(open.pending, 1)
assert.equal(open.brier, null, 'no graded weeks means no score, not a flattering zero')
assert.equal(open.points, null)

// A built ledger: four weeks, three won.
const build = (rows) => {
  let l = {}
  for (const r of rows) l = G.recordWeek(l, { week: r.w, pWin: r.p, myMu: r.mu, mySd: r.sd ?? 100, daysLeft: r.d ?? 7 })
  return G.settle(l, rows.map((r) => ({ week: r.w, my: r.my, opp: r.opp })))
}
const s = G.score(build([
  { w: 1, p: 0.6, mu: 1400, my: 1450, opp: 1300 },
  { w: 2, p: 0.7, mu: 1400, my: 1380, opp: 1500 },
  { w: 3, p: 0.8, mu: 1400, my: 1420, opp: 1200 },
  { w: 4, p: 0.55, mu: 1400, my: 1500, opp: 1400 },
]))
assert.equal(s.graded, 4)
assert.deepEqual(s.record, { won: 3, lost: 1 })
// Bias is signed, because "runs 25 points low every week" is a fix and "is off by 25" is not.
assert.equal(s.points.bias, 37.5)
assert.equal(s.points.mae, 47.5)
// Brier by hand: (0.4^2 + 0.7^2 + 0.2^2 + 0.45^2) / 4
assert.ok(Math.abs(s.brier - 0.2231) < 1e-4, `brier ${s.brier}`)
assert.equal(s.baseline, 0.25)
assert.equal(s.beatsCoin, true)

// A model that is confidently wrong has to score worse than the coin, or the page is
// decoration. This is the check that lets the app call itself broken.
const bad = G.score(build([
  { w: 1, p: 0.9, mu: 1400, my: 1000, opp: 1500 },
  { w: 2, p: 0.95, mu: 1400, my: 1000, opp: 1500 },
]))
assert.ok(bad.brier > 0.25 && bad.beatsCoin === false, `confidently wrong must lose to a coin: ${bad.brier}`)

// Ties are not wins and are left out rather than counted either way.
assert.equal(G.score(build([{ w: 1, p: 0.6, mu: 1400, my: 1400, opp: 1400 }])).graded, 0)

// The spread is a claim too: about 68% of weeks should land inside one standard deviation.
const band = G.score(build([
  { w: 1, p: 0.5, mu: 1400, sd: 100, my: 1450, opp: 1300 }, // inside
  { w: 2, p: 0.5, mu: 1400, sd: 100, my: 1700, opp: 1300 }, // outside
]))
assert.equal(band.points.within1sd, 0.5)
assert.equal(band.points.expected1sd, 0.68)

// Buckets show where it is wrong, not just that it is.
assert.deepEqual(s.buckets.map((b) => b.n), [1, 1, 1, 1]) // 0.55, 0.6, 0.7, 0.8 land one to a bucket
assert.equal(s.buckets.find((b) => b.from === 0.8).actual, 1)

// Four weeks is not a season. The page may show the number; it may not call it a verdict.
assert.equal(s.enoughForProbability, false)
assert.equal(G.score(build(Array.from({ length: 20 }, (_, i) =>
  ({ w: i + 1, p: 0.6, mu: 1400, my: 1450, opp: 1300 }))), { minForProbability: 20 }).enoughForProbability, true)

// Only a snapshot taken before any games grades the full claim.
assert.equal(G.isFullWeek({ daysLeft: 7 }), true)
assert.equal(G.isFullWeek({ daysLeft: 4 }), false)
assert.equal(G.score(build([{ w: 1, p: 0.6, mu: 1400, my: 1450, opp: 1300, d: 3 }])).fullWeek, 0)

// His total was projected too, so it is graded too, and the margin gets its own spread check.
const twoSided = G.score(G.settle(G.recordWeek({}, { week: 1, pWin: 0.6, myMu: 1400, mySd: 100, oppMu: 1300, oppSd: 100, daysLeft: 7 }),
  [{ week: 1, my: 1500, opp: 1300 }]))
assert.equal(twoSided.points.n, 2)
assert.equal(twoSided.points.bias, 50) // +100 on mine, 0 on his
assert.equal(twoSided.points.z2, 0.5) // (1^2 + 0^2) / 2
assert.equal(twoSided.margin.z2, 0.5) // a 100-point miss on the margin, against sqrt(2) * 100
// The spread correction: untouched with nothing to go on, the replay's answer with only the
// replay, the ledger's answer once the ledger outweighs it, and never past the clip.
assert.equal(G.spreadScale(), 1)
assert.equal(G.spreadScale({ replay: { z2: 2.25 } }), 1.5)
assert.ok(Math.abs(G.spreadScale({ replay: { z2: 2.25 }, ledger: { n: 4000, z2: 1 } }) - 1) < 0.01)
assert.equal(G.spreadScale({ replay: { z2: 9 } }), 1.6)

console.log('grading checks pass')

// ---------- phase 9: the replay ----------
const B = await import('../../worker/backtest.mjs')
// Two teams playing each other Monday, Wednesday and Friday for six weeks, two men each.
const replayLogs = (boost = 1) => {
  const out = []
  let gid = 0
  for (let wk = 0; wk < 6; wk++) {
    for (const day of [0, 2, 4]) {
      const date = new Date(Date.UTC(2025, 9, 20 + wk * 7 + day)).toISOString().slice(0, 10)
      gid++
      const wobble = ((gid % 3) - 1) * 6
      const last = wk === 5 ? boost : 1
      for (const [pid, team, opp, fp] of [[1, 'AAA', 'BBB', 50], [2, 'AAA', 'BBB', 22], [3, 'BBB', 'AAA', 40], [4, 'BBB', 'AAA', 30]]) {
        out.push({ pid, gid: String(gid), date, team, opp, min: 30, fp: (fp + wobble) * last })
      }
    }
  }
  return out
}
const rOpts = { pos: { 1: 'G', 2: 'F', 3: 'G', 4: 'C' }, leagues: 1, teams: 2, roster: 2, starts: 2, skipWeeks: 2 }
const plain = B.replay(replayLogs(), rOpts)
assert.equal(Object.keys(plain).length, 4, 'weeks 3 to 6, one matchup each')
assert.ok(Object.values(plain).every((e) => e.daysLeft === 7 && e.pWin > 0 && e.pWin < 1 && e.final.my > 0))
// No peeking: a final week ten times bigger changes what happened, never what was said.
const peek = B.replay(replayLogs(10), rOpts)
const lastWk = Math.max(...Object.values(plain).map((e) => e.wk))
for (const [k, e] of Object.entries(plain)) {
  assert.equal(peek[k].myMu, e.myMu)
  assert.equal(peek[k].pWin, e.pWin)
  if (e.wk === lastWk) assert.ok(peek[k].final.my > e.final.my * 5, 'the box score is what changed')
}
// The defence table is rebuilt from the games before Monday, with cameos left out.
const cameo = B.dvpFrom([{ pid: 1, opp: 'BBB', min: 4, fp: 90 }], { 1: 'G' })
assert.deepEqual(cameo.teams, {})
console.log('replay checks pass')

