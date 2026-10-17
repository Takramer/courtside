import React, { useState } from 'react'
import { etToday, gamesBetween, weekBounds } from '../lib/model.js'
import { PlayerName, ValueTip, ZCell, catHeaders, fmt } from '../components.jsx'

export function PlayerSearch({ ctx, onPick, filter = () => true, placeholder = 'Add a player: type a name' }) {
  const [q, setQ] = useState('')
  const hits = q.length < 2 ? [] : ctx.players.filter((p) => filter(p) && p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
  return (
    <div className="search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {hits.length > 0 && <ul>{hits.map((p) => <li key={p.id}><button onClick={() => { onPick(p); setQ('') }}>{p.name} <small>{ctx.teams[p.team]?.abbrev} · {p.pos.join('/')}</small></button></li>)}</ul>}
    </div>
  )
}

export default function Team({ ctx }) {
  const { myPlayers, values, settings, teams } = ctx
  const [, b] = weekBounds(etToday())
  const cats = catHeaders(settings)
  const total = {}
  for (const c of cats) total[c.k] = myPlayers.reduce((s, p) => s + (values.get(p.id)?.z[c.k] ?? 0), 0)
  const ranked = [...cats].sort((x, y) => total[y.k] - total[x.k])
  const longOut = myPlayers.filter((p) => (ctx.newsBy.get(p.id) || []).some((n) => n.tags.some((t) => t.k === 'longterm')) && ctx.status(p) === 'out')
  const dropCands = [...new Set([...longOut, ...myPlayers.slice(-2)])]

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>My team</h1>
          <p className="lead">Your roster, ranked best to worst. Green cells are categories a player wins for you; red ones cost you.</p>
        </div>
      </div>
      <PlayerSearch ctx={ctx} filter={(p) => !ctx.mineSet.has(p.id)} onPick={(p) => ctx.setOwner(p.id, 'mine')} />

      {myPlayers.length === 0 ? <p className="muted">No players yet. Draft them in <a href="#draft">Draft</a> or add them above.</p> : <>
        <div className="scroll">
          <table className="t">
            <thead><tr><th>Player</th><th className="num" title="Games left this week (Mon–Sun)">Wk G</th><th className="num"><ValueTip settings={settings} /></th><th className="num" title="Last 15 days vs. his usual level">Form</th>
              {settings.format === 'cats' ? cats.map((c) => <th key={c.k} className="num" title={c.name}>{c.label}</th>) : <th className="num">FPTS/G</th>}<th /></tr></thead>
            <tbody>
              {myPlayers.map((p) => {
                const v = values.get(p.id)
                const hot = v && v.trend > (settings.format === 'points' ? 4 : 1.5); const cold = v && v.trend < -(settings.format === 'points' ? 4 : 1.5)
                return (
                  <tr key={p.id}>
                    <td><PlayerName ctx={ctx} p={p} /></td>
                    <td className="num">{gamesBetween(teams[p.team], etToday(), b).length}</td>
                    <td className="num strong">{fmt(v?.val)}</td>
                    <td className="num">{hot ? <span className="tag good">hot</span> : cold ? <span className="tag bad">cold</span> : <span className="muted">–</span>}</td>
                    {settings.format === 'cats' ? cats.map((c) => <ZCell key={c.k} z={v?.z[c.k]} />) : <td className="num">{fmt(v?.fp)}</td>}
                    <td className="actions"><button className="btn ghost sm" onClick={() => ctx.setOwner(p.id, 'free')}>Remove</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {settings.format === 'cats' && (
          <section>
            <h2>Where you are strong and weak</h2>
            <p className="lead">Each week you play one opponent and win or lose each category. You only need to win most of them (5 of 9), so being strong in 5–6 beats being average in all 9.</p>
            <div className="catbars wide">
              {ranked.map((c) => (
                <div key={c.k}>
                  <span title={c.name}>{c.label}</span>
                  <div className="bar"><i style={{ [total[c.k] >= 0 ? 'left' : 'right']: '50%', width: `${Math.min(50, Math.abs(total[c.k]) * 4)}%`, background: total[c.k] >= 0 ? 'var(--good)' : 'var(--bad)' }} /></div>
                  <span className="num">{fmt(total[c.k])}</span>
                </div>
              ))}
            </div>
            <p>Strongest: <b>{ranked.slice(0, 3).map((c) => c.name).join(', ')}</b>. Weakest: <b>{ranked.slice(-2).map((c) => c.name).join(', ')}</b>. When you pick up or trade for players, favor ones who help your weak spots without hurting the strong ones, or give up on a weak category entirely (see "punting" in <a href="#learn">Learn</a>).</p>
          </section>
        )}

        <section>
          <h2>Drop candidates</h2>
          <p className="lead">When a good free agent appears, these are the players to cut first.</p>
          <ul className="plain">
            {dropCands.map((p) => <li key={p.id}><PlayerName ctx={ctx} p={p} /> <span className="why">{longOut.includes(p) ? 'out for weeks' : 'lowest value on your roster'}</span></li>)}
          </ul>
        </section>
      </>}
    </div>
  )
}
