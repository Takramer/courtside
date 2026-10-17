import React, { useState } from 'react'
import { etToday, gamesBetween, weekBounds } from '../lib/model.js'
import { PlayerName, Tip, ValueTip, ZCell, catHeaders, fmt } from '../components.jsx'
import './season.css'

export function PlayerSearch({ ctx, onPick, filter = () => true, placeholder = 'Add a player: type a name' }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const hits = q.length < 2 ? [] : ctx.players.filter((p) => filter(p) && p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
  const pick = (p) => { onPick(p); setQ(''); setAt(0) }
  // Arrows move, Enter picks the highlighted row, Esc clears: no mouse needed.
  const onKey = (e) => {
    if (e.key === 'Escape') { setQ(''); return }
    if (!hits.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((at + 1) % hits.length) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAt((at - 1 + hits.length) % hits.length) }
    if (e.key === 'Enter') { e.preventDefault(); pick(hits[Math.min(at, hits.length - 1)]) }
  }
  return (
    <div className="search">
      <input value={q} onChange={(e) => { setQ(e.target.value); setAt(0) }} onKeyDown={onKey} placeholder={placeholder} aria-label={placeholder}
        role="combobox" aria-expanded={hits.length > 0} aria-autocomplete="list" autoComplete="off" spellCheck={false} />
      {hits.length > 0 && <ul role="listbox">{hits.map((p, i) => (
        <li key={p.id} role="option" aria-selected={i === at}>
          <button className={i === at ? 'on' : ''} onMouseEnter={() => setAt(i)} onClick={() => pick(p)}>{p.name} <small>{ctx.teams[p.team]?.abbrev || 'FA'} · {p.pos.join('/')}</small></button>
        </li>
      ))}</ul>}
      {q.length >= 2 && !hits.length && <ul><li className="none">No player by that name.</li></ul>}
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
  const swing = settings.format === 'points' ? 4 : 1.5
  const open = settings.rosterSize - myPlayers.length

  return (
    <div className="page season teampage">
      <div className="pagehead">
        <div>
          <h1>My team</h1>
          <p className="lead">Your roster, ranked best to worst.{settings.format === 'cats' && ' Green cells are categories a player wins for you; red ones cost you.'}</p>
        </div>
        {myPlayers.length > 0 && <span className={`rostercount ${open > 0 ? 'warn' : ''}`}><b>{myPlayers.length}</b>/{settings.rosterSize} players</span>}
      </div>
      <PlayerSearch ctx={ctx} filter={(p) => !ctx.mineSet.has(p.id)} onPick={(p) => ctx.moveTo(p.id, 'mine')} placeholder="Add a player you own: type a name" />

      {myPlayers.length === 0 ? (
        <div className="emptystate">
          <b>No players yet.</b>
          <p>Draft them on the Draft page, or type each player you already own in the box above.</p>
          <div className="row"><a className="btn" href="#draft">Go to Draft</a><button className="btn ghost" onClick={ctx.find}>Find a player</button></div>
        </div>
      ) : <>
        {open > 0 && <p className="banner warn">You have {open} open roster spot{open > 1 ? 's' : ''}. An empty spot can never score: add the best free agent from <a href="#waivers">Waivers</a>.</p>}
        <div className="scroll">
          <table className="t roster">
            <thead><tr>
              <th className="stick">Player</th>
              <th className="num"><Tip text="Games left this week (Mon–Sun). More games means more stats.">Wk G</Tip></th>
              <th className="num"><ValueTip settings={settings} /></th>
              <th><Tip text="Last 15 days compared with his usual level.">Form</Tip></th>
              {settings.format === 'cats' ? cats.map((c) => <th key={c.k} className="num" title={c.name}>{c.label}</th>) : <th className="num"><Tip text="Fantasy points per game, projected.">FPTS/G</Tip></th>}
              <th />
            </tr></thead>
            <tbody>
              {myPlayers.map((p, i) => {
                const v = values.get(p.id)
                const hot = v && v.trend > swing; const cold = v && v.trend < -swing
                return (
                  <tr key={p.id}>
                    <td className="stick"><span className="rk"><span className="rank">{i + 1}</span><PlayerName ctx={ctx} p={p} /></span></td>
                    <td className="num">{gamesBetween(teams[p.team], etToday(), b).length}</td>
                    <td className="num strong">{fmt(v?.val)}</td>
                    <td>{hot ? <Tip text="Playing well above his usual level lately. Keep starting him."><span className="tag good">▲ hot</span></Tip>
                      : cold ? <Tip text="Playing well below his usual level lately. Check his news for a reason before you drop him."><span className="tag bad">▼ cold</span></Tip>
                        : <span className="muted">steady</span>}</td>
                    {settings.format === 'cats' ? cats.map((c) => <ZCell key={c.k} z={v?.z[c.k]} />) : <td className="num">{fmt(v?.fp)}</td>}
                    <td className="actions"><button className="btn ghost sm" onClick={() => ctx.moveTo(p.id, 'free')} aria-label={`Remove ${p.name} from my team`}>Remove</button></td>
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
          <div className="sechead">
            <h2>Drop candidates</h2>
            <a href="#waivers">Find a replacement on Waivers →</a>
          </div>
          <p className="lead">When a good free agent appears, cut these first.</p>
          <ul className="dropcards">
            {dropCands.map((p) => (
              <li key={p.id}>
                <PlayerName ctx={ctx} p={p} />
                <span className={`why ${longOut.includes(p) ? 'bad' : ''}`}>{longOut.includes(p) ? 'Out for weeks: he scores nothing while he is hurt.' : `Lowest value on your roster (${fmt(values.get(p.id)?.val)}): the easiest to replace.`}</span>
                <button className="btn ghost sm" onClick={() => ctx.moveTo(p.id, 'free')}>I dropped him</button>
              </li>
            ))}
          </ul>
        </section>
      </>}
    </div>
  )
}
