// What the pages read the engine through. Pure: no React, no fetch, so `node src/pages/today.check.js`
// can run it. Every screen that shows projected points or odds prices players with priceSide,
// so no two screens disagree; the moves come from src/lib/decide.js.
import { gameOn, gamesBetween } from '../lib/model.js'
import { availability, isB2B, marginQuantiles, mateNow, nightlyLoad, priceGames, projectPlayer, weekOutlook } from '../lib/predict.js'
import { rankMoves } from '../lib/decide.js'

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const weekDates = (mon) => Array.from({ length: 7 }, (_, i) => {
  const d = new Date(`${mon}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10)
})
export const dayName = (date) => DAY[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]
const plus = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

// form.json more than 3 days old, or from last season, has its recent misses ignored (spec, change 0).
export const formFresh = (ctx, now = Date.now()) => !!ctx.formCurrent && now - Date.parse(ctx.formUpdated ?? '') < 3 * 864e5

// One player's games from `from` to `to`, priced per game. A game that has tipped off is already
// in ESPN's score; counting it here would price it twice.
function schedule(ctx, { team, pos, form }, from, to, now, { today = from, status = 'ok', longOut = false, fresh = true, mate = null } = {}) {
  const t = ctx.teams[team]
  const games = gamesBetween(t, from, to).filter((g) => g.d > today || g.t > now)
    .map((g) => ({ d: g.d, opp: ctx.teams[g.opp]?.abbrev, b2b: isB2B(t?.games, g.d) }))
  return priceGames({ games, today, status, longOut, form, formFresh: fresh, dvp: ctx.dvp, pos, mate })
}

// Rotation minutes each team is missing tonight, from the live report (change 5). Built once per
// priceSide call; mateNow leaves out the man being priced.
function mates(ctx) {
  const by = new Map()
  const status = new Map()
  for (const [id, r] of ctx.formBy || []) {
    const p = ctx.byId?.get(id)
    if (p && ctx.status) status.set(r, ctx.status(p))
    if (!by.has(r.team)) by.set(r.team, [])
    by.get(r.team).push(r)
  }
  const statusOf = (r) => status.get(r) ?? 'ok'
  return (form) => (form?.miss_avg == null || !form.team ? null
    : { now: mateNow(form.team, by.get(form.team), statusOf, form), usual: form.miss_avg })
}

/**
 * One side, priced for predict.js and decide.js: a projection per player and, per game left
 * this week and next, the chance he plays and what he draws. `keep` prices a man with no data at
 * zero instead of leaving him out, so a roster count stays a roster count.
 * Player shape: spec "Decision-layer API".
 */
export function priceSide(ctx, side, today, weekEnd, currentSeason, now, { keep = false } = {}) {
  const out = []
  let unknown = 0
  const fresh = formFresh({ ...ctx, formCurrent: currentSeason }, now)
  const mateOf = mates(ctx)
  const nextMon = plus(weekEnd, 1)
  for (const p of side.players) {
    const known = ctx.byId.get(p.id)
    const form = ctx.formBy.get(p.id)
    const espnFp = ctx.values.get(p.id)?.fp
    const pos = known?.pos || p.pos || []
    const team = p.team ?? known?.team
    // The live matchup's injury flag is fresher than the pool's, so it goes in first.
    const inj = p.inj || known?.inj
    const { status, longOut } = availability({ inj, report: ctx.injuryBy.get(p.id), news: ctx.newsBy.get(p.id) })
    const tip = gameOn(ctx.teams[team], today)
    const base = {
      id: p.id, name: p.name, pos, team, status, longOut, val: ctx.values.get(p.id)?.val ?? null, avail: form?.avail,
      irEligible: inj === 'OUT' || inj === 'INJURY_RESERVE', locked: !!tip && tip.t <= now,
    }
    if (espnFp == null && !form) {
      unknown++
      if (keep) out.push({ ...base, mean: 0, sd: 0, pPlay: 0, games: 0, dates: [], adj: null, play: [], next: { dates: [], adj: null, play: [] } })
      continue
    }
    const proj = projectPlayer({ espnFp, form, status, current: currentSeason, formFresh: fresh })
    const who = { team, pos, form }
    const wk = schedule(ctx, who, today, weekEnd, now, { status, longOut, fresh, mate: mateOf(form) })
    const next = schedule(ctx, who, nextMon, plus(nextMon, 6), now, { today, status, longOut, fresh })
    out.push({ ...base, ...proj, ...wk, games: wk.dates.length, next })
  }
  return { players: out, unknown }
}

// The same men in a later week, healthy: tradeCheck prices future weeks this way (spec, tradeCheck).
export const priceWeek = (ctx, players, { start, end }, now = Date.now()) => players.map((p) => {
  const wk = schedule(ctx, { team: p.team, pos: p.pos, form: ctx.formBy.get(p.id) }, start, end, now)
  return { ...p, ...wk, games: wk.dates.length }
})

// The week's odds from ESPN's live matchup: win chance, twenty endings, nights per side.
export function weekOdds(ctx, d, { today, weekStart, weekEnd, slots, now = Date.now() }) {
  if (!d?.me || !d?.opp || !ctx.players.length) return null
  // A man in an IR slot scores nothing for either side, healthy or not.
  const active = (side) => ({ players: side.players.filter((p) => p.slot !== 'IR') })
  const mine = priceSide(ctx, active(d.me), today, weekEnd, ctx.formCurrent, now)
  const theirs = priceSide(ctx, active(d.opp), today, weekEnd, ctx.formCurrent, now)
  if (!mine.players.length || !theirs.players.length) return null
  const daysLeft = Math.max(1, Math.round((Date.parse(`${weekEnd}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5) + 1)
  const out = weekOutlook(mine.players, theirs.players, {
    starts: slots, days: daysLeft, banked: [d.me.week || 0, d.opp.week || 0], sdScale: ctx.sdScale,
  })
  const nights = weekDates(weekStart).filter((x) => x >= today)
  return {
    ...out,
    daysLeft,
    q: marginQuantiles(out.me, out.opp, 20, ctx.sdScale),
    nights,
    load: [nightlyLoad(mine.players, nights), nightlyLoad(theirs.players, nights)],
    unknown: mine.unknown + theirs.unknown,
    oppPlayers: theirs.players, // priced, for rankMoves
  }
}

/**
 * Ranked moves for today: rankMoves in src/lib/decide.js. The ctx and the Move shape are in the
 * spec ("Decision-layer API"); kinds are start, add, swap, ir, activate, hold.
 */
export const todayMoves = rankMoves
