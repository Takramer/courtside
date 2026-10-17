import React, { useState } from 'react'
import { etToday, gamesBetween, weekBounds } from '../lib/model.js'
import { PlayerName, Tip, ValueTip, ZCell, catHeaders, fmt } from '../components.jsx'

const SORTS = [
  ['val', 'Best overall', 'Highest value for the rest of the season.'],
  ['week', 'Best this week', 'Value times games left this week. Use for short-term pickups.'],
  ['form', 'Hottest', 'Playing furthest above his usual level over the last 15 days.'],
  ['trend', 'Most added', 'Rising fastest in ESPN ownership: other managers are grabbing him.'],
]

export default function Waivers({ ctx }) {
  const { players, values, settings, teams } = ctx
  const [sort, setSort] = useState('val')
  const [pos, setPos] = useState('All')
  const [, b] = weekBounds(etToday())
  const games = (p) => gamesBetween(teams[p.team], etToday(), b).length
  const key = {
    val: (p) => values.get(p.id)?.val ?? -99,
    week: (p) => (values.get(p.id)?.val ?? -99) * games(p) + games(p) * 0.01,
    form: (p) => values.get(p.id)?.trend ?? -99,
    trend: (p) => p.ownChg,
  }[sort]
  const list = players.filter((p) => ctx.isFree(p) && ctx.status(p) !== 'out' && (pos === 'All' || p.pos.includes(pos)))
    .sort((x, y) => key(y) - key(x)).slice(0, 60)
  const worstMine = ctx.myPlayers[ctx.myPlayers.length - 1]
  const worstVal = worstMine ? values.get(worstMine.id)?.val ?? 0 : null
  const cats = catHeaders(settings)

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Waiver wire</h1>
          <p className="lead">Players nobody in your league owns. Adding the right one each week is the biggest edge most managers ignore.
            {!ctx.exactTaken && <> Until you finish your draft here, players on more than {settings.ownCutoff}% of ESPN teams are hidden as "probably taken".</>}</p>
        </div>
      </div>
      <div className="filters">
        <div className="seg">{SORTS.map(([k, label, why]) => <button key={k} title={why} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>)}</div>
        <div className="seg">{['All', 'PG', 'SG', 'SF', 'PF', 'C'].map((x) => <button key={x} className={pos === x ? 'on' : ''} onClick={() => setPos(x)}>{x}</button>)}</div>
      </div>
      {worstMine && <p className="muted">Your weakest player is {worstMine.name} (value {fmt(worstVal)}). Anyone below with clearly higher value is an upgrade. "Pick up" = add him, drop {worstMine.name.split(' ').slice(-1)}.</p>}
      <div className="scroll">
        <table className="t">
          <thead><tr><th>Player</th><th className="num">Wk G</th><th className="num"><ValueTip settings={settings} /></th>
            <th className="num"><Tip text="Last 15 days minus his usual level. Positive = playing better than expected.">Form</Tip></th>
            <th className="num"><Tip text="% of ESPN leagues where he is rostered, and the change today.">Owned</Tip></th>
            {settings.format === 'cats' ? cats.map((c) => <th key={c.k} className="num" title={c.name}>{c.label}</th>) : <th className="num">FPTS/G</th>}<th /></tr></thead>
          <tbody>
            {list.map((p) => {
              const v = values.get(p.id)
              const upgrade = worstVal != null && v && v.val - worstVal > (settings.format === 'points' ? 2 : 0.6)
              return (
                <tr key={p.id}>
                  <td><PlayerName ctx={ctx} p={p} />{upgrade && <span className="tag good">upgrade</span>}</td>
                  <td className="num">{games(p)}</td>
                  <td className="num strong">{fmt(v?.val)}</td>
                  <td className="num">{v?.trend ? fmt(v.trend) : '–'}</td>
                  <td className="num">{fmt(p.own, 0)}% <small className={p.ownChg > 0 ? 'up' : p.ownChg < 0 ? 'down' : ''}>{p.ownChg > 0 ? '+' : ''}{fmt(p.ownChg)}</small></td>
                  {settings.format === 'cats' ? cats.map((c) => <ZCell key={c.k} z={v?.z[c.k]} />) : <td className="num">{fmt(v?.fp)}</td>}
                  <td className="actions"><button className="btn sm" onClick={() => ctx.setOwner(p.id, 'mine')}>I added him</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
