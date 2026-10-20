import React, { useState } from 'react'
import { bestLineup, etToday, gamesBetween, weekBounds } from '../lib/model.js'
import { PlayerName, Tip, ValueTip, ZCell, catHeaders, fmt, heat } from '../components.jsx'
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

// The single most expensive thing wrong with the roster right now, with its fix attached.
// One strip, never a list: if everything below it is equally loud, nothing is an alert.
function Alert({ ctx, lineup, open, games }) {
  const broken = lineup.starters
    .map(({ slot, player }) => ({ slot, player, ...(player ? ctx.avail(player) : { status: 'empty' }) }))
    .filter((r) => r.status === 'out' || r.status === 'empty')
  const gtd = lineup.starters.filter((r) => r.player && ctx.avail(r.player).status === 'dtd')
  // The swap only gets offered when there is something to swap in: the best bench player who
  // fits the slot and is not himself hurt.
  const fill = lineup.benched.find((p) => ctx.avail(p).status === 'ok')

  if (broken.length) {
    const r = broken[0]
    return (
      <div className="alertstrip">
        <span className="tagx">Lineup</span>
        <p>
          {r.status === 'empty'
            ? <>Your <b>{r.slot}</b> slot is empty. An empty slot can never score.</>
            : <><b>{r.player.name}</b> is ruled out and holds your <b>{r.slot}</b> slot. An out starter scores nothing.</>}
          {fill && <> <b>{fill.name}</b> is on the bench with {games(fill)} games left.</>}
          {broken.length > 1 && <span className="muted"> {broken.length - 1} more slot{broken.length > 2 ? 's' : ''} like this.</span>}
        </p>
        {fill && <button className="btn" onClick={() => ctx.open(fill.id)}>Open {fill.name.split(' ').slice(-1)[0]}</button>}
      </div>
    )
  }
  if (open > 0) {
    return (
      <div className="alertstrip warn">
        <span className="tagx">Roster</span>
        <p>{open} open roster spot{open > 1 ? 's' : ''}. An empty spot can never score.</p>
        <a className="btn" href="#waivers">Waivers</a>
      </div>
    )
  }
  if (gtd.length) {
    return (
      <div className="alertstrip warn">
        <span className="tagx">Watch</span>
        <p><b>{gtd[0].player.name}</b> is a game-time decision at <b>{gtd[0].slot}</b>. Check him an hour before the tip.
          {gtd.length > 1 && <span className="muted"> {gtd.length - 1} more.</span>}</p>
        <button className="btn ghost" onClick={() => ctx.open(gtd[0].player.id)}>Open him</button>
      </div>
    )
  }
  return null
}

// What has happened to this roster lately. Two kinds, kept apart on purpose: the ones that
// have already moved a projection, and the ones that are only here to be read.
function Events({ ctx, myPlayers }) {
  const rows = myPlayers.map((p) => ({ p, ...ctx.avail(p) })).filter((r) => r.status !== 'ok' || r.flags.length)
  if (!rows.length) return <p className="muted" style={{ margin: 0, fontSize: 12 }}>Nobody hurt, nobody in the news. Rare.</p>
  const priced = rows.filter((r) => r.status !== 'ok')
  const read = rows.filter((r) => r.flags.length)
  return (
    <>
      {priced.length > 0 && (
        <ul className="plain evlist">
          {priced.map(({ p, status, why, source }) => (
            <li key={p.id}>
              <button className="link" onClick={() => ctx.open(p.id)}>{p.name}</button>
              {' '}<span className={`badge ${status}`}>{status === 'out' ? 'OUT' : 'GTD'}</span>
              {why && <span className="muted"> {why}{source ? ` (${source})` : ''}</span>}
            </li>
          ))}
        </ul>
      )}
      {read.length > 0 && (
        <>
          <h4>Off the court</h4>
          <ul className="plain evlist">
            {read.map(({ p, flags }) => (
              <li key={p.id}>
                <button className="link" onClick={() => ctx.open(p.id)}>{p.name}</button>
                <span className="muted"> {flags.map((f) => f.title).join(' · ')}</span>
              </li>
            ))}
          </ul>
          <small>
            These change no number here. An arrest or a bereavement can cost games, but by how
            much is a judgement, and a figure invented for it would quietly bend the win
            probability and every waiver call after it. Read them and decide.
          </small>
        </>
      )}
    </>
  )
}

export default function Team({ ctx }) {
  const { myPlayers, values, settings, teams } = ctx
  const [, weekEnd] = weekBounds(etToday())
  // Best to worst is how he has always read this roster, so that is the default. The slot
  // column means lineup order is one click away without being the thing you land on.
  const [order, setOrder] = useState('value')
  const cats = catHeaders(settings)
  const games = (p) => gamesBetween(teams[p.team], etToday(), weekEnd).length

  const total = {}
  for (const c of cats) total[c.k] = myPlayers.reduce((s, p) => s + (values.get(p.id)?.z[c.k] ?? 0), 0)
  const ranked = [...cats].sort((x, y) => total[y.k] - total[x.k])
  const longOut = myPlayers.filter((p) => (ctx.newsBy.get(p.id) || []).some((n) => n.tags.some((t) => t.k === 'longterm')) && ctx.status(p) === 'out')
  const dropCands = [...new Set([...longOut, ...myPlayers.slice(-2)])]
  const swing = settings.format === 'points' ? 4 : 1.5
  const open = settings.rosterSize - myPlayers.length
  const slots = settings.slots.split(',').map((x) => x.trim()).filter(Boolean)
  const lineup = bestLineup(myPlayers, slots)

  // One table instead of a lineup strip above a roster table. The slot column is the answer
  // to "who do I start", and the value column is the answer to "who is worth keeping", so
  // they belong on the same row. Rank is always by value, whatever the row order.
  const rankOf = new Map(myPlayers.map((p, i) => [p.id, i + 1]))
  const slotOf = new Map(lineup.starters.filter((r) => r.player).map((r) => [r.player.id, r.slot]))
  const rows = order === 'lineup'
    ? [...lineup.starters.filter((r) => r.player).map((r) => ({ slot: r.slot, p: r.player, start: true })),
       ...lineup.benched.map((p) => ({ slot: 'BN', p, start: false }))]
    : myPlayers.map((p) => ({ slot: slotOf.get(p.id) || 'BN', p, start: slotOf.has(p.id) }))
  const maxVal = Math.max(1, ...myPlayers.map((p) => values.get(p.id)?.val ?? 0))

  if (myPlayers.length === 0) {
    return (
      <div className="page">
        <div className="pagehead"><div><h1>My team</h1><p className="lead">Type each player you own, one at a time.</p></div></div>
        <PlayerSearch ctx={ctx} filter={(p) => !ctx.mineSet.has(p.id)} onPick={(p) => ctx.moveTo(p.id, 'mine')} placeholder="Add a player you own: type a name" />
        <div className="emptystate">
          <b>No players yet.</b>
          <p>Add them above, or connect your ESPN league and let it fill the roster for you.</p>
          <div className="row"><button className="btn" onClick={ctx.find}>Find a player</button> <a className="btn ghost" href="#league">Connect my league</a></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page deskpage teampage">
      <Alert ctx={ctx} lineup={lineup} open={open} games={games} />

      <div className="desk">
        <section className="deskmain" aria-label="Roster">
          <div className="deskbar">
            <div className="seg" role="group" aria-label="Row order">
              <button className={order === 'lineup' ? 'on' : ''} aria-pressed={order === 'lineup'} onClick={() => setOrder('lineup')}>Lineup order</button>
              <button className={order === 'value' ? 'on' : ''} aria-pressed={order === 'value'} onClick={() => setOrder('value')}>By value</button>
            </div>
            <PlayerSearch ctx={ctx} filter={(p) => !ctx.mineSet.has(p.id)} onPick={(p) => ctx.moveTo(p.id, 'mine')} placeholder="Add a player you own" />
          </div>
          <div className="scroll deskscroll">
            <table className="t roster">
              <thead><tr>
                <th className="num rk" style={{ width: 26 }}>#</th>
                <th><Tip text="Where he goes in your ESPN lineup. G = any guard, F = any forward, PF/C = power forward or centre, UT = anyone, BN = bench and scores nothing.">Slot</Tip></th>
                <th className="stick">Player</th>
                <th className="num"><Tip text="Games left this week (Mon–Sun). More games means more stats.">G</Tip></th>
                <th className="num"><ValueTip settings={settings} /></th>
                {settings.format === 'cats' ? cats.map((c) => <th key={c.k} className="num" title={c.name}>{c.label}</th>) : <th className="num"><Tip text="Fantasy points per game, projected.">Fpts/g</Tip></th>}
                <th className="num opt"><Tip text="How much he swings game to game, from last season's logs. A 30-point average that swings 18 is a different player from one that swings 6: the steady one wins close weeks, the wild one is how you win a week you should lose.">±</Tip></th>
                <th className="num opt"><Tip text="Share of his team's games he actually played last season. 79% means he sat roughly one night in five.">Avl</Tip></th>
                <th className="opt"><Tip text="Last 15 days compared with his usual level.">Form</Tip></th>
                <th />
              </tr></thead>
              <tbody>
                {rows.map(({ slot, p, start }) => {
                  const v = values.get(p.id)
                  const f = ctx.formBy.get(p.id)
                  const hot = v && v.trend > swing; const cold = v && v.trend < -swing
                  const hurt = ctx.status(p)
                  return (
                    <tr key={p.id} className={`${start ? 'start' : 'bench'}${hurt === 'out' && start ? ' broken' : ''}`}>
                      <td className="num rk">{rankOf.get(p.id)}</td>
                      <td className="slot">{slot}</td>
                      <td className="stick"><PlayerName ctx={ctx} p={p} /></td>
                      <td className="num">{games(p)}</td>
                      <td className="heat"><i style={heat(v?.val, maxVal)} /><span>{fmt(v?.val)}</span></td>
                      {settings.format === 'cats' ? cats.map((c) => <ZCell key={c.k} z={v?.z[c.k]} />) : <td className="num muted">{fmt(v?.fp)}</td>}
                      <td className="num muted opt">{f ? fmt(f.fp_sd, 0) : '–'}</td>
                      <td className="num muted opt">{f?.avail != null ? `${Math.round(f.avail * 100)}%` : '–'}</td>
                      <td className="opt">{hot ? <Tip text="Playing well above his usual level lately. Keep starting him."><span className="tag good">hot</span></Tip>
                        : cold ? <Tip text="Playing well below his usual level lately. Check his news before you drop him."><span className="tag bad">cold</span></Tip>
                          : <span className="dim">steady</span>}</td>
                      <td className="actions"><button className="btn ghost sm" onClick={() => ctx.moveTo(p.id, 'free')} aria-label={`Remove ${p.name} from my team`}>×</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="deskside" aria-label="Readouts">
          <div className="read">
            <h3>Worth knowing this week</h3>
            <Events ctx={ctx} myPlayers={myPlayers} />
          </div>

          {settings.format === 'cats' && (
            <div className="read">
              <h3>Category strength</h3>
              <div className="catbars wide">
                {ranked.map((c) => (
                  <div key={c.k}>
                    <span title={c.name}>{c.label}</span>
                    <div className="bar"><i style={{ [total[c.k] >= 0 ? 'left' : 'right']: '50%', width: `${Math.min(50, Math.abs(total[c.k]) * 4)}%`, background: total[c.k] >= 0 ? 'var(--good)' : 'var(--bad)' }} /></div>
                    <span className="num">{fmt(total[c.k])}</span>
                  </div>
                ))}
              </div>
              <small>You only need to win most categories, not all of them. Strong in five or six beats average in nine.
                Strongest: <b>{ranked.slice(0, 3).map((c) => c.name).join(', ')}</b>. Weakest: <b>{ranked.slice(-2).map((c) => c.name).join(', ')}</b>.</small>
            </div>
          )}

          <div className="read">
            <h3>Cut first</h3>
            <ul className="plain cutlist">
              {dropCands.map((p) => (
                <li key={p.id}>
                  <div className="row1">
                    <button className="link" onClick={() => ctx.open(p.id)}>{p.name}</button>
                    <span className="num">{fmt(values.get(p.id)?.val)}</span>
                  </div>
                  <span className={`why ${longOut.includes(p) ? 'bad' : ''}`}>{longOut.includes(p) ? 'Out for weeks: he scores nothing while he is hurt.' : 'Lowest value on the roster: the easiest to replace.'}</span>
                  <button className="btn ghost sm" onClick={() => ctx.moveTo(p.id, 'free')}>I dropped him</button>
                </li>
              ))}
            </ul>
            <p style={{ margin: '10px 0 0' }}><a href="#waivers">Find a replacement on Waivers →</a></p>
          </div>

          <div className="read">
            <h3>Lineup note</h3>
            <small>Set this in ESPN before the first game of the day. Sit anyone ruled out: an injured
              starter scores nothing, your bench player scores something.</small>
          </div>
        </aside>
      </div>
    </div>
  )
}
