import React, { useMemo } from 'react'
import { etToday, gamesBetween, weekBounds } from '../lib/model.js'
import { teamWeek } from '../lib/predict.js'
import { FlagBadge, StatusBadge, fmt } from '../components.jsx'
import { priceSide, todayMoves, weekDates } from './today.js'

const KIND = { start: 'Start', add: 'Add', swap: 'Swap', ir: 'IR', activate: 'Activate', hold: 'Hold' }
const BLOCKED = { limit: 'past this week\'s acquisition limit', locked: 'his game has tipped, so wait until tomorrow' }
const pct = (x) => `${Math.round(x * 100)}%`
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1)
// A number never wraps away from its words: "3 next week" stays on one line.
const glue = (t) => t.replace(/(\d[\d.,%]*) /g, '$1\u00a0').replace(/\b(next|this|last) (week|season)\b/g, '$1\u00a0$2')
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A move's title with each player's name opening his panel.
function Linked({ ctx, text, ids }) {
  const ps = ids.map((id) => ctx.byId.get(id)).filter(Boolean)
  if (!ps.length) return text
  const re = new RegExp(`(${ps.map((p) => escape(p.name)).join('|')})`)
  return text.split(re).map((part, i) => {
    const p = ps.find((x) => x.name === part)
    return p ? <button key={i} className="link" onClick={() => ctx.open(p.id)}>{part}</button> : part
  })
}

export default function Today({ ctx }) {
  const { settings: s, myPlayers, live, odds } = ctx
  const today = etToday()
  const [weekStart, weekEnd] = weekBounds(today)
  const slots = s.slots.split(',').map((x) => x.trim()).filter(Boolean)
  const d = live.data
  // Connected, ESPN says who is on IR and who starts tonight; otherwise the app assumes.
  const espnRow = ctx.linked && d?.me ? new Map(d.me.players.map((p) => [p.id, p])) : null

  const plan = useMemo(() => {
    const now = Date.now()
    const nights = weekDates(weekStart).filter((x) => x >= today)
    // Unconnected, IR is the same guess the Roster page shows (App's splitIR), so the two pages agree.
    const onIR = new Set(espnRow ? myPlayers.filter((p) => espnRow.get(p.id)?.slot === 'IR').map((p) => p.id) : ctx.irPlayers.map((p) => p.id))
    const price = (players, opts) => priceSide(ctx, { players }, today, weekEnd, ctx.formCurrent, now, opts).players
    const roster = price(myPlayers.filter((p) => !onIR.has(p.id)), { keep: true })
    // Free agents worth pricing: the best for the season, and the best for what is left of this week.
    const val = (p) => ctx.values.get(p.id)?.val ?? -99
    const left = (p) => gamesBetween(ctx.teams[p.team], today, weekEnd).length
    const healthy = ctx.players.filter((p) => ctx.isFree(p) && ctx.status(p) !== 'out')
    const pool = [...new Set([
      ...[...healthy].sort((a, b) => val(b) - val(a)).slice(0, 20),
      ...[...healthy].sort((a, b) => val(b) * left(b) - val(a) * left(a)).slice(0, 15),
    ])]
    // Connected: the league's acquisition count for my team, and the matchups still to play.
    const acq = ctx.linked && ctx.league.acq
      ? { limit: ctx.league.acq.limit, used: ctx.league.acq.byTeam?.[ctx.espn.team] ?? ctx.league.acq.used ?? 0 } : null
    const moves = todayMoves({
      today, nights, slots, rosterSize: s.rosterSize, roster, free: price(pool),
      irOpen: Math.max(0, (s.ir ?? 0) - onIR.size),
      ir: price(myPlayers.filter((p) => onIR.has(p.id)), { keep: true }),
      starters: espnRow ? d.me.players.filter((p) => p.starting).map((p) => p.id) : null,
      odds: odds ? { me: odds.me, opp: odds.opp, sdScale: odds.sdScale } : null,
      opp: odds?.oppPlayers ?? null,
      banked: odds ? [odds.me.banked, odds.opp.banked] : [0, 0],
      sdScale: ctx.sdScale, acq, weeksLeft: ctx.linked ? ctx.league.weeksLeft ?? 0 : 0,
    })
    const week = teamWeek(roster, { starts: slots.length, days: nights.length })
    const tonight = roster.filter((p) => p.status !== 'out' && p.dates.includes(today)).length
    return { moves, week, nights, tonight }
  }, [ctx.players, ctx.values, myPlayers, d, odds, ctx.formBy, ctx.dvp, ctx.newsBy, ctx.injuryBy, ctx.league.freeIds, ctx.league.acq, ctx.league.weeksLeft, ctx.taken, ctx.irPlayers, today, s.slots, s.rosterSize, s.ir])

  const alerts = myPlayers.map((p) => ({ p, ...ctx.avail(p) })).filter((r) => r.status !== 'ok' || r.flags.length)
    .sort((a, b) => (a.status === 'out' ? 0 : a.status === 'dtd' ? 1 : 2) - (b.status === 'out' ? 0 : b.status === 'dtd' ? 1 : 2))
  const margin = odds ? odds.me.mu - odds.opp.mu : 0

  return (
    <div className="page today">
      <h1 className="sr">Today</h1>
      <section className="hero" aria-label="This week">
        {odds && d?.opp ? (
          <>
            <p className="eyebrow">Week {d.matchupPeriod} vs {d.opp.name}</p>
            <p className="heroline"><span className="big">{pct(odds.pWin)}</span><span className="heroword">to win the week</span></p>
            <p className="herosub">
              Projected {margin >= 0 ? '+' : '−'}{fmt(Math.abs(margin), 0)}: {fmt(odds.me.mu, 0)} to {fmt(odds.opp.mu, 0)}. <a href="#week">Matchup</a>
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">This week, {plan.nights.length} night{plan.nights.length === 1 ? '' : 's'} left</p>
            <p className="heroline"><span className="big">{fmt(plan.week.mu, 0)}</span><span className="heroword">points left</span></p>
            <p className="herosub">
              {ctx.linked && live.loading ? 'Reading your matchup from ESPN…' : <><a href="#league">Connect your league</a> for win odds.</>}
            </p>
          </>
        )}
        <p className="herosub">Tonight: {plan.tonight} playing for {slots.length} slots.</p>
      </section>

      <div className="todaygrid">
        <section aria-labelledby="moves-h">
          <h2 id="moves-h">Moves</h2>
          <ol className="moves">
            {plan.moves.map((m, i) => (
              <li key={`${m.kind}${m.playerIds.join('-')}`} className={`move${i === 0 && m.kind !== 'hold' ? ' first' : ''}`}>
                <span className="kind">{KIND[m.kind]}</span>
                <div className="mbody">
                  <p className="mtitle"><Linked ctx={ctx} text={m.title} ids={m.playerIds} /></p>
                  <p className="mwhy">{glue(cap(m.reason))}{m.blocked && `; ${BLOCKED[m.blocked]}`}</p>
                </div>
                <div className="mgain">
                  {m.gainPts > 0 && <b>+{fmt(m.gainPts, 0)} pts</b>}
                  {m.gainWin != null && m.gainWin >= 0.005 && <span>+{pct(m.gainWin)} win</span>}
                  {m.gainNext >= 1 && <span>+{fmt(m.gainNext, 0)} next wk</span>}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="alerts-h">
          <h2 id="alerts-h">Alerts</h2>
          {alerts.length ? (
            <ul className="alerts">
              {alerts.map(({ p, status, why, source, flags }) => (
                <li key={p.id}>
                  <span className="aname">
                    <button className="link" onClick={() => ctx.open(p.id)}>{p.name}</button>
                    <StatusBadge ctx={ctx} p={p} />
                    <FlagBadge ctx={ctx} p={p} />
                  </span>
                  <span className="awhy">{status !== 'ok' ? `${why || 'Status'}${source ? ` (${source})` : ''}` : flags[0].title}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Nobody hurt or flagged.</p>}
        </section>
      </div>
    </div>
  )
}
