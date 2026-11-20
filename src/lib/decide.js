// The decision layer: which roster moves are worth making, priced by the same engine that
// gives the week's odds. Pure functions, no React, no fetch. Spec: .scratch/engine-v2/spec.md,
// "Decision-layer API". `rankMoves` keeps todayMoves' output shape (src/pages/today.js) and
// adds fields, so the page swaps one import.
import { bestLineup } from './model.js'
import { playChance, teamWeek, winProbability } from './predict.js'

// One currency for this week and the weeks after: expected wins. 0.399 is the slope of the
// normal curve at an even matchup; 236 the typical margin sd in the 2025-26 replay
// (SD_MARGIN, worker/experiments/05-summary.mjs). So a point next week is worth 0.399/236 wins.
const SLOPE = 0.399
const SD_MARGIN = 236
const TIE = 0.002 // wins: closer than this is a tie, broken by points, then cost, then name
const STREAM_MIN = 3 // points a streaming step must add over the nights left
const ACCEPT = 0.15 // ponytail: 0.15 wins is a judgement, not a fit.

const r1 = (x) => Math.round(x * 10) / 10
const r4 = (x) => (x == null ? null : +x.toFixed(4))
const last = (name) => name.split(' ').filter((w, i) => i === 0 || !/^(jr|sr|i{2,3}|iv|v)\.?$/i.test(w)).slice(-1)[0]
const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const playOf = (p, i) => p.play?.[i] ?? p.pPlay ?? 0

// A player limited to games on dates that pass `keep` (parallel arrays stay parallel).
function only(p, keep) {
  const idx = (p.dates || []).map((d, i) => (keep(d) ? i : -1)).filter((i) => i >= 0)
  return { ...p, dates: idx.map((i) => p.dates[i]), adj: p.adj ? idx.map((i) => p.adj[i]) : null,
    play: p.play ? idx.map((i) => p.play[i]) : null, games: idx.length }
}
// Next Monday-Sunday in this week's slots.
const asNext = (p) => ({ ...p, dates: p.next?.dates ?? [], adj: p.next?.adj ?? null, play: p.next?.play ?? null, games: p.next?.dates?.length ?? 0 })

// Everything rankMoves, streamPlan and tradeCheck share: the two weeks before any move, the
// opponent, and a way to score a changed roster against them.
function setup(ctx) {
  const { slots, nights = [], roster, opp = null, odds = null, banked = [0, 0], weeksLeft = 0 } = ctx
  const starts = slots.length
  const sdScale = ctx.sdScale ?? odds?.sdScale ?? 1
  const wk = (ps) => teamWeek(ps, { starts, days: nights.length || 1, banked: banked[0] })
  const nx = (ps) => teamWeek(ps.map(asNext), { starts, days: 7 })
  // Priced opponent players when we have them; todayMoves' odds summary otherwise.
  const oppWeek = opp ? teamWeek(opp, { starts, days: nights.length || 1, banked: banked[1] })
    : odds ? { mu: odds.opp.mu, variance: odds.opp.sd ** 2 } : null
  const win = (w) => (oppWeek ? winProbability(w, oppWeek, sdScale) : null)
  const before = wk(roster)
  const beforeNext = nx(roster)
  const pBefore = win(before)
  // The numbers every move carries. `after` is the active roster once the move is made.
  const price = (after) => {
    const a = wk(after)
    const gainPts = a.mu - before.mu
    const gainNext = nx(after).mu - beforeNext.mu
    const gainWin = oppWeek ? win(a) - pBefore : null
    const gainSeason = gainWin == null ? null : gainWin + weeksLeft * SLOPE * gainNext / SD_MARGIN
    return { gainPts, gainWin, gainNext, gainSeason }
  }
  return { starts, sdScale, wk, nx, oppWeek, win, before, beforeNext, pBefore, price }
}

// The bar a roster move has to clear: better for the season, and worth a point this week or next.
const clears = (m) => (m.gainSeason ?? m.gainPts + m.gainNext) > 0 && (m.gainPts >= 1 || m.gainNext >= 1)

function byValue(a, b) {
  if (a.gainSeason != null && b.gainSeason != null && Math.abs(a.gainSeason - b.gainSeason) >= TIE) return b.gainSeason - a.gainSeason
  if (a.gainSeason == null && Math.abs(a.gainPts - b.gainPts) < 0.05 && a.gainNext !== b.gainNext) return b.gainNext - a.gainNext
  return (b.gainPts - a.gainPts) || (a.uses - b.uses) || a.title.localeCompare(b.title)
}

const move = (kind, title, reason, playerIds, { add = null, drop = null, uses = 0, blocked = null }, g) => ({
  kind, title, reason, playerIds, add, drop, uses, blocked,
  gainPts: r1(g.gainPts), gainWin: r4(g.gainWin), gainNext: r1(g.gainNext ?? 0), gainSeason: r4(g.gainSeason),
})

/**
 * Ranked moves for today. ctx is todayMoves' ctx (today, nights, slots, rosterSize, roster,
 * irOpen, starters, free, odds) plus opp, banked, sdScale, acq, weeksLeft, ir, max. See the
 * spec for every field. Returns Move[] best first; a lone 'hold' when nothing clears the bar.
 *
 * ponytail: teamWeek starts the best ten each night, not the best legal ten, and this inherits
 * it. Fix it there if a third centre ever shows up as a start.
 */
export function rankMoves(ctx) {
  const { today, slots, rosterSize, roster, irOpen = 0, starters = null, free = [], ir = [], acq = null, max = 6 } = ctx
  const S = setup(ctx)
  const moves = []

  // ---- tonight's lineup, as todayMoves does it, on per-game play chances
  const tonight = (p) => {
    const i = (p.dates || []).indexOf(today)
    return i < 0 ? 0 : playOf(p, i) * p.mean * (p.adj?.[i] ?? 1)
  }
  const byVal = [...roster].sort((a, b) => (b.val ?? -99) - (a.val ?? -99))
  const current = new Set(starters ?? bestLineup(byVal, slots).starters.filter((r) => r.player).map((r) => r.player.id))
  // A starter whose game has tipped holds his slot whatever we think of him now.
  const value = (p) => (p.locked && current.has(p.id) ? 1e9 : tonight(p))
  const playing = roster.filter((p) => value(p) > 0).sort((a, b) => value(b) - value(a))
  const best = bestLineup(playing, slots).starters.filter((r) => r.player).map((r) => r.player)
  const bestIds = new Set(best.map((p) => p.id))
  const ins = best.filter((p) => !current.has(p.id))
  // An injured starter with a game tonight is the swap to name first: "has no game" is harmless
  // to leave, "out" is the action (todayMoves did this; the UI pass restored it).
  const hurt = (p) => (p.status === 'out') * 2 + (p.dates || []).includes(today)
  const outs = roster.filter((p) => current.has(p.id) && !bestIds.has(p.id)).sort((a, b) => tonight(a) - tonight(b) || hurt(b) - hurt(a))
  // What skipping a start costs: the odds already assume the best lineup.
  const startWin = (g) => (S.oppWeek ? S.pBefore - S.win({ mu: S.before.mu - g, variance: S.before.variance }) : null)
  const start = (title, reason, ids, g) => moves.push(move('start', title, reason, ids, {}, { gainPts: g, gainWin: startWin(g), gainNext: 0, gainSeason: startWin(g) }))
  // ponytail: pairs the best man sitting with the worst man starting, as todayMoves does.
  ins.forEach((x, i) => {
    const y = outs[i]
    const g = tonight(x) - (y ? tonight(y) : 0)
    if (g < 1) return
    const why = !y ? 'open slot tonight'
      : y.status === 'out' ? `${last(y.name)} is out${(y.dates || []).includes(today) ? ' tonight' : ''}`
        : !(y.dates || []).includes(today) ? `${last(y.name)} has no game tonight`
          : `${last(x.name)} projects ${Math.round(g)} more`
    start(y ? `Start ${x.name} over ${y.name} tonight` : `Start ${x.name} tonight`, why, y ? [x.id, y.id] : [x.id], g)
  })
  // A day-to-day man priced at his coin flip who still beats the bench keeps his slot; say who
  // goes in if he sits.
  const bench = playing.filter((p) => !bestIds.has(p.id))[0]
  for (const p of best.filter((q) => q.status === 'dtd' && current.has(q.id) && !q.locked)) {
    if (!bench) break
    start(`Start ${p.name} tonight, check before tip`, `${last(p.name)} is day-to-day; if he sits, start ${bench.name}`,
      [p.id, bench.id], Math.max(0, tonight(p) - tonight(bench)))
  }

  // ---- roster moves. One free agent per move, so the list can be done top to bottom.
  const used = new Set()
  const bestAdd = (keep, pool = free) => {
    let pick = null
    for (const f of pool) {
      if (used.has(f.id)) continue
      const g = S.price([...keep, f])
      if (!pick || byValue({ ...g, uses: 1, title: f.name }, { ...pick.g, uses: 1, title: pick.f.name }) < 0) pick = { f, g }
    }
    return pick
  }
  const plays = (f) => `${last(f.name)} has ${f.dates?.length ?? f.games ?? 0} game${(f.dates?.length ?? f.games) === 1 ? '' : 's'} left, ${f.next?.dates?.length ?? 0} next week`
  const ranked = S.before.players.filter((p) => roster.some((r) => r.id === p.id))
  const weakest = (pool) => [...pool].sort((a, b) => (ranked.find((r) => r.id === a.id)?.mu ?? 0) - (ranked.find((r) => r.id === b.id)?.mu ?? 0))[0]

  // activate: ESPN blocks every add while an IR man is healthy. First, whatever it is worth.
  const activations = []
  for (const p of ir.filter((q) => !q.irEligible)) {
    const open = rosterSize - roster.length > 0
    const drop = open ? null : weakest(roster.filter((q) => !q.locked))
    const g = S.price([...roster.filter((q) => q.id !== drop?.id), p])
    activations.push(move('activate', drop ? `Activate ${p.name}, drop ${drop.name}` : `Activate ${p.name}`,
      `${last(p.name)} is off the injury list; ESPN blocks adds until he leaves IR`,
      drop ? [p.id, drop.id] : [p.id], { add: p.id, drop: drop?.id ?? null }, g))
  }

  // ir: an eligible man moves to an open IR spot, and his spot goes to the best free agent.
  let irLeft = irOpen
  const toIR = new Set()
  for (const p of roster.filter((q) => q.irEligible)) {
    if (irLeft <= 0) break
    irLeft--
    toIR.add(p.id)
    const keep = roster.filter((q) => q.id !== p.id)
    const pick = bestAdd(keep)
    const blocked = p.locked ? 'locked' : null
    if (pick && clears(pick.g)) {
      used.add(pick.f.id)
      moves.push(move('ir', `Move ${p.name} to IR, add ${pick.f.name}`, `${last(p.name)} is out; ${plays(pick.f)}`,
        [p.id, pick.f.id], { add: pick.f.id, drop: p.id, uses: 1, blocked }, pick.g))
    } else {
      moves.push(move('ir', `Move ${p.name} to IR`, `${last(p.name)} is out; IR frees his spot`, [p.id],
        { drop: p.id, blocked }, { gainPts: 0, gainWin: S.oppWeek ? 0 : null, gainNext: 0, gainSeason: S.oppWeek ? 0 : null }))
    }
  }

  // add: an open roster spot. A bench-level add earns his gain on nights the roster leaves a
  // slot empty, so the reason names those nights instead of his games.
  // ponytail: counts heads against slots, not positions; bestLineup if a slot ever stays open.
  const likely = (p, d) => { const i = (p.dates || []).indexOf(d); return i >= 0 && playOf(p, i) >= 0.5 }
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const fills = (f) => {
    const open = (ctx.nights || []).filter((d) => d >= today && likely(f, d) && roster.filter((p) => likely(p, d)).length < slots.length)
    if (!open.length) return null
    const days = open.map((d) => DAY[new Date(`${d}T12:00:00Z`).getUTCDay()])
    return `fills your open ${days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${days.at(-1)} slots` : `${days[0]} slot`}`
  }
  for (let k = 0; k < rosterSize - roster.length; k++) {
    const pick = bestAdd(roster)
    if (!pick || !clears(pick.g)) break
    used.add(pick.f.id)
    moves.push(move('add', `Add ${pick.f.name}`, fills(pick.f) ?? plays(pick.f), [pick.f.id], { add: pick.f.id, uses: 1 }, pick.g))
  }

  // swap: the 4 men who add least this week against the 12 best free agents. A locked man is
  // never offered as a drop.
  // ponytail: each move is priced alone against today's roster; two moves done together are
  // close to, not exactly, the sum.
  const drops = ranked.filter((p) => !p.locked && !toIR.has(p.id)).slice(-4)
  // Off-spec guard: a man who is not out long-term keeps his season value, which
  // weeksLeft x gainNext cannot see: next week stands in for the whole season, so a free agent
  // with four games next week looked as good as a better man with three, and the UI pass saw
  // "Add Brook Lopez, drop Michael Porter Jr." So he is only swapped for someone at least as
  // good by `val`, except the roster's weakest by `val`, who is the streaming spot (todayMoves'
  // rule).
  // ponytail: val is the season proxy; price the weeks after next per game if this ever blocks
  // a swap that should go through.
  const streamer = [...roster].filter((p) => p.val != null).sort((a, b) => a.val - b.val)[0]
  const worthIt = (d, f) => d.longOut || d.id === streamer?.id || d.val == null || f.val == null || f.val >= d.val
  const pool = free.filter((f) => !used.has(f.id))
    .sort((a, b) => b.mean * sum((b.dates || []).map((_, i) => playOf(b, i))) - a.mean * sum((a.dates || []).map((_, i) => playOf(a, i))))
    .slice(0, 12)
  const pairs = []
  for (const d of drops) {
    const keep = roster.filter((q) => q.id !== d.id)
    for (const f of pool) {
      if (!worthIt(d, f)) continue
      const g = S.price([...keep, f])
      if (clears(g)) pairs.push({ d, f, g, uses: 1, title: f.name, ...g })
    }
  }
  pairs.sort(byValue)
  const dropped = new Set()
  for (const { d, f, g } of pairs) {
    if (dropped.size >= 3) break
    if (dropped.has(d.id) || used.has(f.id)) continue
    dropped.add(d.id); used.add(f.id)
    const why = d.status === 'out' ? `${last(d.name)} is out; ${plays(f)}` : `${plays(f)}; ${last(d.name)} adds ${r1(d.mu)} this week`
    moves.push(move('swap', `Add ${f.name}, drop ${d.name}`, why, [f.id, d.id], { add: f.id, drop: d.id, uses: 1 }, g))
  }

  moves.sort(byValue)
  const all = [...activations, ...moves]
  if (!all.length) return [move('hold', 'Hold', 'no move gains a point this week', [], {}, { gainPts: 0, gainWin: S.oppWeek ? 0 : null, gainNext: 0, gainSeason: S.oppWeek ? 0 : null })]

  // Acquisition limit: ranked as usual, and everything past what is left is marked.
  const left = acq?.limit == null ? Infinity : Math.max(0, acq.limit - (acq.used ?? 0))
  let spent = 0
  for (const m of all) {
    if (m.uses !== 1) continue
    spent++
    if (spent > left && !m.blocked) {
      m.blocked = 'limit'
      if (left === 0) m.title += ' (no acquisitions left this week)'
    }
  }
  return all.slice(0, max)
}

/**
 * The best use of this week's acquisitions with one roster spot churned. Greedy by date: each
 * night, the free agent with a game that night who adds most over the nights still to come
 * replaces whoever holds the spot, if that is worth STREAM_MIN points.
 * returns { steps: [{ date, add, drop, gainPts }], gainPts, gainWin, left }
 * The single Monday step was tested in the replay (04-decisions.mjs); the plan as a whole is not.
 */
export function streamPlan(ctx) {
  const { today, nights = [], roster, free = [], acq = null } = ctx
  const S = setup(ctx)
  let left = acq?.limit == null ? Infinity : Math.max(0, acq.limit - (acq.used ?? 0))
  const contrib = (id) => S.beforeNext.players.find((p) => p.id === id)?.mu ?? 0
  const holder0 = roster.filter((p) => !p.locked && p.status !== 'out').sort((a, b) => contrib(a.id) - contrib(b.id))[0]
  const empty = { steps: [], gainPts: 0, gainWin: S.oppWeek ? 0 : null, left: left === Infinity ? null : left }
  if (!holder0) return empty

  const rest = roster.filter((p) => p.id !== holder0.id)
  const steps = []
  let holder = holder0
  const used = new Set()
  for (const d of nights.filter((x) => x >= today)) {
    if (left <= 0) break
    const ahead = (p) => only(p, (x) => x >= d)
    const base = S.wk([...rest, holder].map(ahead)).mu
    let pick = null
    for (const f of free) {
      if (used.has(f.id) || !(f.dates || []).includes(d)) continue
      const g = S.wk([...rest, f].map(ahead)).mu - base
      if (!pick || g > pick.g) pick = { f, g }
    }
    if (!pick || pick.g < STREAM_MIN) continue
    steps.push({ date: d, add: pick.f.id, drop: holder.id, gainPts: r1(pick.g) })
    used.add(pick.f.id)
    holder = pick.f
    left--
  }
  if (!steps.length) return empty

  // The whole plan as one roster: each man in the spot keeps only his own stretch of nights.
  const seq = [holder0, ...steps.map((s) => free.find((f) => f.id === s.add))]
  const cut = [today, ...steps.map((s) => s.date), '9999-12-31']
  const spot = seq.map((p, k) => only(p, (x) => x >= (k ? cut[k] : '') && x < cut[k + 1]))
  const after = S.wk([...rest, ...spot])
  return {
    steps,
    gainPts: r1(after.mu - S.before.mu),
    gainWin: S.oppWeek ? r4(S.win(after) - S.pBefore) : null,
    left: left === Infinity ? null : left,
  }
}

/**
 * Is a trade worth it? ctx as rankMoves plus weeks [{ start, end, weight }], priceWeek
 * (players, week) => priced players, oppFor(week) => priced opponents or null, effective date.
 * trade = { give: ids, get: priced players }. The roster is made legal first (a 2-for-1 comes
 * with its waiver pickup), then this week and every future week are priced before and after.
 */
export function tradeCheck(ctx, trade) {
  const { today, roster, rosterSize, free = [], weeks = [], priceWeek, oppFor = () => null, effective = today } = ctx
  const S = setup(ctx)
  const give = new Set(trade.give)
  const inTrade = (p) => give.has(p.id) || trade.get.some((g) => g.id === p.id)
  let after = [...roster.filter((p) => !give.has(p.id)), ...trade.get]
  const alsoDrop = []
  const alsoAdd = []
  while (after.length > rosterSize) {
    const d = after.filter((p) => !inTrade(p)).sort((a, b) => (a.val ?? -99) - (b.val ?? -99))[0]
    if (!d) break
    alsoDrop.push(d.id)
    after = after.filter((p) => p.id !== d.id)
  }
  while (after.length < rosterSize) {
    const base = S.nx(after).mu
    const f = free.filter((x) => !alsoAdd.includes(x.id) && !after.some((p) => p.id === x.id))
      .map((x) => ({ x, g: S.nx([...after, x]).mu - base })).sort((a, b) => b.g - a.g)[0]?.x
    if (!f) break
    alsoAdd.push(f.id)
    after = [...after, f]
  }

  // This week, from the day the trade takes effect.
  const from = (ps) => ps.map((p) => only(p, (d) => d >= effective))
  const nowBefore = S.wk(from(roster))
  const nowAfter = S.wk(from(after))
  const gainPts = nowAfter.mu - nowBefore.mu
  const gainWin = S.oppWeek ? S.win(nowAfter) - S.win(nowBefore) : null

  // Future weeks: everyone healthy except the long-term out, who is priced at nothing.
  const assumes = ['Future weeks: every man plays at his healthy rate three days ahead, no back-to-backs.']
  const gone = new Map([...roster, ...after].filter((p) => p.longOut).map((p) => [p.id, p.name]))
  for (const name of gone.values()) assumes.push(`${name} is out long-term: 0 in every future week.`)
  if (alsoDrop.length || alsoAdd.length) assumes.push('The roster is made legal with the drops and adds listed.')
  const future = (ps) => ps.map((p) => ({ ...p, play: (p.dates || []).map(() => (p.longOut ? 0 : playChance({ daysAhead: 3, avail: p.avail ?? 1 }))) }))
  const byWeek = weeks.map((w) => {
    const b = teamWeek(future(priceWeek(roster, w)), { starts: S.starts, days: 7 })
    const a = teamWeek(future(priceWeek(after, w)), { starts: S.starts, days: 7 })
    const opp = oppFor(w)
    const ow = opp ? teamWeek(opp, { starts: S.starts, days: 7 }) : null
    const dPts = a.mu - b.mu
    const dWin = ow ? winProbability(a, ow, S.sdScale) - winProbability(b, ow, S.sdScale) : SLOPE * dPts / SD_MARGIN
    return { start: w.start, dPts: r1(dPts), dWin: r4(dWin), weight: w.weight ?? 1 }
  })
  const deltaWins = sum(byWeek.map((w) => w.weight * w.dWin))
  const total = deltaWins + (gainWin ?? SLOPE * gainPts / SD_MARGIN)
  assumes.push('Verdict on this week plus every future week, in expected wins.')
  return {
    gainPts: r1(gainPts), gainWin: r4(gainWin),
    deltaPtsPerWeek: byWeek.length ? r1(sum(byWeek.map((w) => w.dPts)) / byWeek.length) : 0,
    deltaWins: r4(deltaWins),
    wins: r4(total), // this week plus every future week: what the verdict reads
    byWeek: byWeek.map(({ start, dPts, dWin }) => ({ start, dPts, dWin })),
    alsoDrop, alsoAdd,
    verdict: total > ACCEPT ? 'accept' : total < -ACCEPT ? 'decline' : 'close',
    assumes,
  }
}
