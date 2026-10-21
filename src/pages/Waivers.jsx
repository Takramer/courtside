import React, { useState } from 'react'
import { etToday, gamesBetween, weekBounds } from '../lib/model.js'
import { PlayerName, Tip, ValueTip, ZCell, catHeaders, fmt, heat } from '../components.jsx'
import './season.css'

const SORTS = [
  ['val', 'Best overall', 'Highest value for the rest of the season. Use for permanent pickups.'],
  ['week', 'Best this week', 'Value times games left this week. Use for short-term pickups.'],
  ['form', 'Hottest', 'Playing furthest above his usual level over the last 15 days.'],
  ['trend', 'Most added', 'Rising fastest in ESPN ownership: other managers are grabbing him.'],
]
const POS = [['All', 'All'], ['PG', 'Point guard'], ['SG', 'Shooting guard'], ['SF', 'Small forward'], ['PF', 'Power forward'], ['C', 'Center']]

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
  const all = players.filter((p) => ctx.isFree(p) && ctx.status(p) !== 'out' && (pos === 'All' || p.pos.includes(pos)))
  const list = all.sort((x, y) => key(y) - key(x)).slice(0, 60)
  const maxVal = Math.max(1, ...list.map((p) => values.get(p.id)?.val ?? 0))
  // Who you would drop to make room — a man on IR is not holding a spot, so he is never the answer.
  const worstMine = ctx.activePlayers[ctx.activePlayers.length - 1]
  const worstVal = worstMine ? values.get(worstMine.id)?.val ?? 0 : null
  const cats = catHeaders(settings)
  const short = worstMine?.name.split(' ').slice(-1)[0]
  let ups = 0

  return (
    <div className="page season waiverpage">
      <div className="pagehead">
        <div>
          <h1>Waiver wire</h1>
          <p className="lead">Players nobody in your league owns. Adding the right one each week is the biggest edge most managers ignore.
            {ctx.linked
              ? <> These are the players ESPN itself lists as free in your league, read at {new Date(ctx.league.at).toLocaleTimeString()}.</>
              : !ctx.exactTaken && <> This list cannot see your league's other nine rosters, so anyone owned in more than {settings.ownCutoff}% of ESPN leagues is hidden as "probably taken". Connect your league on <a href="#league">League setup</a> to read the real thing.</>}</p>
        </div>
      </div>

      {worstMine
        ? <div className="dropnote">
          <span className="lbl">Your weakest player</span>
          <span><PlayerName ctx={ctx} p={worstMine} /> <span className="muted">value {fmt(worstVal)}</span></span>
          <p>Rows marked <span className="tag good">upgrade</span> are clearly better than him. To swap: add the new player and drop {short} in your league app, then tap "I added him" here.</p>
        </div>
        : <p className="banner warn">Add your team on <a href="#team">My team</a> first so this page can mark which free agents are upgrades.</p>}

      <div className="filters">
        <div className="fgroup"><span className="flabel">Sort by</span>
          <div className="seg" role="group" aria-label="Sort by">{SORTS.map(([k, label]) => <button key={k} aria-pressed={sort === k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>)}</div>
        </div>
        <div className="fgroup"><span className="flabel">Position</span>
          <div className="seg" role="group" aria-label="Position">{POS.map(([x, name]) => <button key={x} title={name} aria-pressed={pos === x} className={pos === x ? 'on' : ''} onClick={() => setPos(x)}>{x}</button>)}</div>
        </div>
      </div>
      <p className="hint">{SORTS.find((s) => s[0] === sort)[2]} {list.length > 0 && <span className="muted">Showing {list.length} of {all.length} available{pos !== 'All' && ` at ${POS.find((x) => x[0] === pos)[1].toLowerCase()}`}.</span>}</p>

      {list.length === 0 ? (
        <div className="emptystate">
          <b>No available {pos === 'All' ? 'players' : POS.find((x) => x[0] === pos)[1].toLowerCase() + 's'} right now.</b>
          <p>{pos !== 'All' ? 'Try all positions: a good player at any spot can go in a utility (UT) slot.'
            : ctx.linked ? 'Everyone ESPN lists as free in your league is either hurt or already on your roster.'
            : `Everyone healthy is owned or hidden as "probably taken" (on more than ${settings.ownCutoff}% of ESPN teams). Raise that cutoff on League setup to see more.`}</p>
          {pos !== 'All' && <div className="row"><button className="btn ghost" onClick={() => setPos('All')}>Show all positions</button></div>}
        </div>
      ) : (
        <div className="scroll">
          <table className="t wire">
            <thead><tr><th className="stick">Player</th><th className="num"><Tip text="Games left this week (Mon–Sun). More games means more stats.">Wk G</Tip></th><th className="num"><ValueTip settings={settings} /></th>
              <th className="num opt"><Tip text="Last 15 days minus his usual level. Positive = playing better than expected.">Form</Tip></th>
              <th className="num"><Tip text="% of ESPN leagues where he is rostered, and the change today.">Owned</Tip></th>
              {settings.format === 'cats' ? cats.map((c) => <th key={c.k} className="num" title={c.name}>{c.label}</th>) : <th className="num"><Tip text="Fantasy points per game, projected.">FPTS/G</Tip></th>}<th /></tr></thead>
            <tbody>
              {list.map((p) => {
                const v = values.get(p.id)
                const upgrade = worstVal != null && v && v.val - worstVal > (settings.format === 'points' ? 2 : 0.6)
                const loud = upgrade && ++ups <= 3 // only the first three upgrades get the orange button, so the eye lands there
                return (
                  <tr key={p.id} className={upgrade ? 'upgrade' : ''}>
                    <td className="stick"><PlayerName ctx={ctx} p={p} />{upgrade && <Tip text={`Clearly more valuable than ${worstMine.name}. Worth the swap.`}><span className="tag good">upgrade</span></Tip>}</td>
                    <td className="num">{games(p)}</td>
                    <td className="heat"><i style={heat(v?.val, maxVal)} /><span>{fmt(v?.val)}</span></td>
                    <td className="num opt">{v?.trend ? fmt(v.trend) : '–'}</td>
                    <td className="num">{fmt(p.own, 0)}% <small className={p.ownChg > 0 ? 'up' : p.ownChg < 0 ? 'down' : ''}>{p.ownChg > 0 ? '+' : ''}{fmt(p.ownChg)}</small></td>
                    {settings.format === 'cats' ? cats.map((c) => <ZCell key={c.k} z={v?.z[c.k]} />) : <td className="num">{fmt(v?.fp)}</td>}
                    <td className="actions"><button className={`btn sm ${loud ? '' : 'ghost'}`} onClick={() => ctx.moveTo(p.id, 'mine')}>I added him</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
