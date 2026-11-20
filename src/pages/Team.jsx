import React, { useState } from 'react'
import { bestLineup, etToday, weekBounds } from '../lib/model.js'
import { FormTag, PlayerName, Tip, ValueTip, ZCell, catHeaders, fmt, heat } from '../components.jsx'
import { NightBars, WeekHead, WeekStrip, dayName, weekDates } from '../charts.jsx'
import { nightlyLoad } from '../lib/predict.js'
import { priceSide } from './today.js'

export function PlayerSearch({ ctx, onPick, filter = () => true, placeholder = 'Add a player' }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const hits = q.length < 2 ? [] : ctx.players.filter((p) => filter(p) && p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
  const pick = (p) => { onPick(p); setQ(''); setAt(0) }
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
          <button className={i === at ? 'on' : ''} onMouseEnter={() => setAt(i)} onClick={() => pick(p)}>{p.name} <span className="muted">{ctx.teams[p.team]?.abbrev || 'FA'} · {p.pos.join('/')}</span></button>
        </li>
      ))}</ul>}
      {q.length >= 2 && !hits.length && <ul><li className="none">No player by that name.</li></ul>}
    </div>
  )
}

export default function Team({ ctx }) {
  const { myPlayers, activePlayers, irPlayers, values, settings, teams } = ctx
  const today = etToday()
  const [weekStart, weekEnd] = weekBounds(today)
  const [order, setOrder] = useState('lineup')
  const cats = catHeaders(settings)
  const pts = settings.format === 'points'
  const slots = settings.slots.split(',').map((x) => x.trim()).filter(Boolean)
  const lineup = bestLineup(activePlayers, slots)
  const slotOf = new Map(lineup.starters.filter((r) => r.player).map((r) => [r.player.id, r.slot]))
  const irSet = new Set(irPlayers.map((p) => p.id))
  const rows = order === 'lineup'
    ? [...lineup.starters.filter((r) => r.player).map((r) => ({ slot: r.slot, p: r.player, start: true })),
       ...lineup.benched.map((p) => ({ slot: 'BN', p, start: false })),
       ...irPlayers.map((p) => ({ slot: 'IR', p, start: false }))]
    : myPlayers.map((p) => ({ slot: irSet.has(p.id) ? 'IR' : slotOf.get(p.id) || 'BN', p, start: slotOf.has(p.id) }))
  const maxVal = Math.max(1, ...myPlayers.map((p) => values.get(p.id)?.val ?? 0))

  const nights = weekDates(weekStart).filter((d) => d >= today)
  const priced = priceSide(ctx, { players: activePlayers }, today, weekEnd, ctx.formCurrent, Date.now()).players
  const load = nightlyLoad(priced, nights)
  const open = nights.filter((d, i) => load[i] < slots.length && d >= today)
  const over = nights.filter((_, i) => load[i] > slots.length)

  const add = <PlayerSearch ctx={ctx} filter={(p) => !ctx.mineSet.has(p.id)} onPick={(p) => ctx.moveTo(p.id, 'mine')} placeholder="Add a player you own" />

  if (myPlayers.length === 0) {
    return (
      <div className="page">
        <h1>Roster</h1>
        {add}
        <div className="emptystate">
          <b>No players yet.</b>
          <div className="row"><a className="btn" href="#league">Connect league</a></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page rosterpage">
      <div className="pagehead">
        <h1>Roster</h1>
        <div className="tools">
          <div className="seg" role="group" aria-label="Row order">
            <button className={order === 'lineup' ? 'on' : ''} aria-pressed={order === 'lineup'} onClick={() => setOrder('lineup')}>Lineup</button>
            <button className={order === 'value' ? 'on' : ''} aria-pressed={order === 'value'} onClick={() => setOrder('value')}>Value</button>
          </div>
          {add}
        </div>
      </div>

      <table className="t fold roster">
        <thead><tr>
          <th className="slot"><Tip text="G any guard, F any forward, PF/C power forward or centre, UT anyone, BN bench, IR injured reserve">Slot</Tip></th>
          <th className="player">Player</th>
          <th className="week"><WeekHead mon={weekStart} today={today} /></th>
          <th className="num val"><ValueTip settings={settings} /></th>
          {pts ? <th className="num fp">Pts/g</th> : cats.map((c) => <th key={c.k} className="num opt" title={c.name}>{c.label}</th>)}
          <th className="num opt"><Tip text="Game-to-game swing, last season">±</Tip></th>
          <th className="num opt"><Tip text="Share of games played, last season">Avail</Tip></th>
          <th className="opt">Form</th>
          <th className="actions"><span className="sr">Remove</span></th>
        </tr></thead>
        <tbody>
          {rows.map(({ slot, p, start }) => {
            const v = values.get(p.id)
            const f = ctx.formBy.get(p.id)
            const out = ctx.status(p) === 'out'
            return (
              <tr key={p.id} className={`${start ? 'start' : 'bench'}${slot === 'IR' ? ' onir' : ''}${out && start ? ' broken' : ''}`}>
                <td className="slot">{slot}</td>
                <td className="player"><PlayerName ctx={ctx} p={p} /></td>
                <td className="week"><WeekStrip team={teams[p.team]} teams={teams} mon={weekStart} today={today} /></td>
                <td className="heat val"><i style={heat(v?.val, maxVal)} /><span>{fmt(v?.val)}</span></td>
                {pts ? <td className="num fp">{fmt(v?.fp)}</td> : cats.map((c) => <ZCell key={c.k} z={v?.z[c.k]} />)}
                <td className="num opt">{f ? fmt(f.fp_sd, 0) : '–'}</td>
                <td className="num opt">{f?.avail != null ? `${Math.round(f.avail * 100)}%` : '–'}</td>
                <td className="opt"><FormTag v={v} settings={settings} /></td>
                <td className="actions"><button className="icon" onClick={() => ctx.moveTo(p.id, 'free')} aria-label={`Remove ${p.name}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button></td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {nights.length > 0 && (
        <section aria-labelledby="nights-h">
          <h2 id="nights-h">Nights left</h2>
          <NightBars dates={nights} slots={slots.length} today={today} series={[{ name: 'You', tone: 'you', values: load }]} />
          <p className="note">
            {open.length > 0 && <>Open slots: <b>{open.map((d) => `${dayName(d)} ${slots.length - load[nights.indexOf(d)]}`).join(', ')}</b>. </>}
            {over.length > 0 && <>Someone sits: <b>{over.map((d) => `${dayName(d)} ${load[nights.indexOf(d)] - slots.length}`).join(', ')}</b>.</>}
            {!open.length && !over.length && 'Every night fills its slots.'}
          </p>
        </section>
      )}
    </div>
  )
}
