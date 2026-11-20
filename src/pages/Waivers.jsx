import React, { useState } from 'react'
import { etToday, weekBounds } from '../lib/model.js'
import { FormTag, PlayerName, Tip, ValueTip, ZCell, catHeaders, fmt, heat, sfmt } from '../components.jsx'
import { WeekHead, WeekStrip } from '../charts.jsx'
import { priceSide } from './today.js'

// Short labels fit 44px buttons at 320; the full phrase is the accessible name.
const SORTS = [['val', 'Season'], ['week', 'Week', 'This week'], ['form', 'Hot'], ['trend', 'Added', 'Most added']]
const POS = ['All', 'PG', 'SG', 'SF', 'PF', 'C']

export default function Waivers({ ctx }) {
  const { players, values, settings, teams } = ctx
  const [sort, setSort] = useState('val')
  const [pos, setPos] = useState('All')
  const [more, setMore] = useState(false)
  const today = etToday()
  const [mon, sun] = weekBounds(today)
  const all = players.filter((p) => ctx.isFree(p) && ctx.status(p) !== 'out' && (pos === 'All' || p.pos.includes(pos)))
  // "This week" is the engine's expected points over the games left, priced as on Today, so the
  // two pages rank a pickup the same way.
  const weekPts = sort === 'week'
    ? new Map(priceSide(ctx, { players: all }, today, sun, ctx.formCurrent, Date.now()).players
      .map((p) => [p.id, p.dates.reduce((n, _, i) => n + (p.play?.[i] ?? p.pPlay) * p.mean * (p.adj?.[i] ?? 1), 0)]))
    : null
  const key = {
    val: (p) => values.get(p.id)?.val ?? -99,
    week: (p) => weekPts.get(p.id) ?? -99,
    form: (p) => values.get(p.id)?.trend ?? -99,
    trend: (p) => p.ownChg,
  }[sort]
  const ranked = all.sort((x, y) => key(y) - key(x)).slice(0, 60)
  // Twenty-five rows answer the question; the rest wait behind one button.
  const list = more ? ranked : ranked.slice(0, 25)
  const maxVal = Math.max(1, ...list.map((p) => values.get(p.id)?.val ?? 0))
  // Who you would drop: a man on IR holds no spot, so he is never the answer.
  const worst = ctx.activePlayers[ctx.activePlayers.length - 1]
  const worstVal = worst ? values.get(worst.id)?.val ?? 0 : null
  const cats = catHeaders(settings)
  const pts = settings.format === 'points'
  let ups = 0

  return (
    <div className="page waiverpage">
      <div className="pagehead">
        <h1>Waivers</h1>
        <span className="muted">
          {ctx.linked ? `ESPN free agents, ${new Date(ctx.league.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            : !ctx.exactTaken && <Tip text={`Not connected: anyone on more than ${settings.ownCutoff}% of ESPN teams is hidden`}>Estimated</Tip>}
        </span>
      </div>

      {worst && <p className="weakest">Your weakest: <PlayerName ctx={ctx} p={worst} sub={false} /> <span className="num">{fmt(worstVal)}</span></p>}

      <div className="filters">
        <div className="seg" role="group" aria-label="Sort by">{SORTS.map(([k, label, full]) => <button key={k} aria-label={full} aria-pressed={sort === k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>)}</div>
        <div className="seg" role="group" aria-label="Position">{POS.map((x) => <button key={x} aria-pressed={pos === x} className={pos === x ? 'on' : ''} onClick={() => setPos(x)}>{x}</button>)}</div>
      </div>

      {list.length === 0 ? (
        <div className="emptystate">
          <b>No healthy free agents{pos !== 'All' && ` at ${pos}`}.</b>
          {pos !== 'All' && <div className="row"><button className="btn ghost" onClick={() => setPos('All')}>All positions</button></div>}
        </div>
      ) : (
        <table className="t fold wire">
          <thead><tr>
            <th className="player">Player</th>
            <th className="week"><WeekHead mon={mon} today={today} /></th>
            <th className="num val"><ValueTip settings={settings} /></th>
            {pts ? <th className="num fp">Pts/g</th> : cats.map((c) => <th key={c.k} className="num opt" title={c.name}>{c.label}</th>)}
            <th className="opt"><Tip text={pts ? 'Last 15 days vs projected, points a game' : 'Last 15 days against his usual level'}>Form</Tip></th>
            <th className="num opt"><Tip text="Share of ESPN teams, change today">Owned</Tip><span className="ownpad" aria-hidden="true" /></th>
            <th className="actions"><span className="sr">Add</span></th>
          </tr></thead>
          <tbody>
            {list.map((p) => {
              const v = values.get(p.id)
              const upgrade = worstVal != null && v && v.val - worstVal > (pts ? 2 : 0.6)
              const loud = upgrade && ++ups <= 3
              return (
                <tr key={p.id} className={upgrade ? 'upgrade' : ''}>
                  <td className="player"><div className="pline"><PlayerName ctx={ctx} p={p} />{upgrade && <span className="tag good">Upgrade</span>}</div></td>
                  <td className="week"><WeekStrip team={teams[p.team]} teams={teams} mon={mon} today={today} /></td>
                  <td className="heat val"><i style={heat(v?.val, maxVal)} /><span>{fmt(v?.val)}</span></td>
                  {pts ? <td className="num fp">{fmt(v?.fp)}</td> : cats.map((c) => <ZCell key={c.k} z={v?.z[c.k]} />)}
                  <td className="opt"><FormTag v={v} settings={settings} /></td>
                  <td className="num opt">{fmt(p.own, 0)}% <span className="muted ownchg">{sfmt(p.ownChg)}</span></td>
                  <td className="actions"><button className={`btn sm ${loud ? '' : 'ghost'}`} onClick={() => ctx.moveTo(p.id, 'mine')} aria-label={`I added ${p.name}`}>I added him</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {!more && ranked.length > list.length && <div className="more"><button className="btn ghost" onClick={() => setMore(true)}>Show {ranked.length - list.length} more</button></div>}
    </div>
  )
}
