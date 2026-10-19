import React, { useEffect, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { CATS, etToday, gamesBetween, tagNews, weekBounds } from './lib/model.js'
import { defenderHistory, frictionFor } from './lib/predict.js'
import './pages/extras.css'

export const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : x.toFixed(d))
export const ago = (iso) => {
  const h = (Date.now() - new Date(iso)) / 36e5
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`
}

export function Tip({ children, text }) {
  return <span className="tip" title={text} tabIndex={0} data-tip={text}>{children}</span>
}

export function StatusBadge({ ctx, p }) {
  const { status, why, source } = ctx.avail(p)
  if (status === 'ok') return null
  const label = status === 'out' ? (p.inj === 'SUSPENSION' ? 'SUSP' : 'OUT') : 'GTD'
  // Say what decided it, not just that something did. "RotoWire: ruled out Thursday" is
  // checkable in a way that a bare badge is not.
  const text = why ? `${source}: ${why}` : `ESPN status: ${String(p.inj || '').replace(/_/g, ' ').toLowerCase()}`
  return <Tip text={text}><span className={`badge ${status}`}>{label}</span></Tip>
}

// Off-court events, marked and never priced. The badge is deliberately quiet and the
// tooltip says outright that it moves no number: the moment a grudge or a court date
// starts nudging a projection, every number downstream stops meaning what it says.
export function FlagBadge({ ctx, p }) {
  const { flags } = ctx.avail(p)
  if (!flags.length) return null
  const kinds = [...new Set(flags.map((f) => f.tag))]
  const text = `${flags.map((f) => f.title).join(' · ')} — surfaced, not priced: this changes no projection in the app.`
  return <Tip text={text}><span className="badge flag">{kinds.includes('legal') ? 'LEGAL' : 'OFF-COURT'}</span></Tip>
}

export function PlayerName({ ctx, p, sub = true }) {
  const team = ctx.teams[p.team]
  const fresh = (ctx.newsBy.get(p.id) || []).some((n) => Date.now() - new Date(n.date) < 36e5 * 24)
  return (
    <span className="pname">
      <button className="link" onClick={() => ctx.open(p.id)}>{p.name}</button>
      <StatusBadge ctx={ctx} p={p} />
      {fresh && <Tip text="News in the last 24 hours. Click his name to read it."><span className="dot" /></Tip>}
      {sub && <small>{team?.abbrev || 'FA'} · {p.pos.join('/')}</small>}
    </span>
  )
}

export function ZCell({ z }) {
  const c = Math.max(-2.5, Math.min(2.5, z ?? 0)) / 2.5
  const bg = c >= 0 ? `rgba(34,197,94,${c * 0.55})` : `rgba(239,68,68,${-c * 0.55})`
  return <td className="num z" style={{ background: bg }}>{fmt(z, 1)}</td>
}

export const catHeaders = (settings) => CATS.filter((c) => !settings.punt.includes(c.k))

export const ValueTip = ({ settings }) => (
  <Tip text={settings.format === 'points'
    ? 'Fantasy points per game above what a free agent off waivers would give you. 0 = easy to replace.'
    : 'Sum of his category scores above a free agent off waivers. 0 = easy to replace. Higher is better.'}>Value</Tip>
)

export function Tags({ tags }) {
  return tags.map((t) => <Tip key={t.k} text={t.why}><span className={`tag ${t.tone}`}>{t.label}</span></Tip>)
}

export function NewsItem({ n, ctx, showName }) {
  return (
    <li className="news">
      <div className="nhead">
        {showName && n.pid && <PlayerName ctx={ctx} p={ctx.byId.get(n.pid)} sub={false} />}
        <a href={n.link} target="_blank" rel="noreferrer">{n.title}</a>
      </div>
      {n.body && <p>{n.body}</p>}
      <div className="nmeta"><Tags tags={n.tags || []} /><span>{n.src} · {ago(n.date)}</span></div>
    </li>
  )
}

// Plain-English read of a player for someone who has never watched a game.
export function plainTake(ctx, p) {
  const v = ctx.values.get(p.id)
  if (!v) return ['Not enough stats to judge him yet.']
  const out = []
  const { settings } = ctx
  const tier = v.rank <= 15 ? 'a first-round star' : v.rank <= 40 ? 'a strong starter' : v.rank <= 90 ? 'a solid starter' : v.rank <= settings.teams * settings.rosterSize ? 'a bench-level player' : 'waiver-wire level'
  out.push(`Ranks #${v.rank} by our value right now: ${tier}.`)
  if (settings.format === 'cats') {
    const good = CATS.filter((c) => v.z[c.k] > 1).map((c) => c.name.toLowerCase())
    const bad = CATS.filter((c) => v.z[c.k] < -1).map((c) => c.name.toLowerCase())
    if (good.length) out.push(`Wins you ${good.join(', ')}.`)
    if (bad.length) out.push(`Hurts you in ${bad.join(', ')}.`)
  } else out.push(`Projects about ${fmt(v.fp)} fantasy points a game.`)
  if (v.trend > (settings.format === 'points' ? 4 : 1.5)) out.push('Playing well above his projection over the last 15 days (hot).')
  if (v.trend < -(settings.format === 'points' ? 4 : 1.5)) out.push('Playing below his projection over the last 15 days (cold). Check the news for a reason.')
  if (v.line.gp < 60) out.push(`Projected for only ${Math.round(v.line.gp)} games, so expect missed time.`)
  const [a, b] = weekBounds(etToday())
  out.push(`${gamesBetween(ctx.teams[p.team], a, b).length} games this week.`)
  if (p.adp) out.push(`Fantasy managers usually draft him around pick #${Math.round(p.adp)}; on ${fmt(p.own, 0)}% of ESPN teams.`)
  return out
}

const LINE_ROWS = [['proj', 'Projection (this season)'], ['cur', 'This season so far'], ['l15', 'Last 15 days'], ['last', 'Last season']]

const STAT_HEAD = [['MIN', 'Minutes'], ['PTS', 'Points'], ['REB', 'Rebounds'], ['AST', 'Assists'], ['STL', 'Steals'], ['BLK', 'Blocks'], ['3PM', '3-pointers made'], ['FG%', 'Field goal %'], ['FT%', 'Free throw %'], ['TO', 'Turnovers (lower is better)'], ['GP', 'Games played']]
const OWNERS = [['mine', 'On my team'], ['taken', 'Another team'], ['free', 'Available']]

// Possession-by-possession history against the men who guard him. The ones he runs into
// this week come first and are marked: the same 31% is trivia against someone retired and
// a reason to think against Thursday's starter.
function Guards({ ctx, p }) {
  const today = etToday()
  const [, weekEnd] = weekBounds(today)
  const facing = gamesBetween(ctx.teams[p.team], today, weekEnd).map((g) => ctx.teams[g.opp]?.abbrev)
  const rows = defenderHistory(ctx.matchups, p.name, facing)
  if (!rows.length) return null
  return (
    <>
      <h3>Who guards him</h3>
      <div className="scroll dstats">
        <table className="t small">
          <thead><tr>
            <th>Defender</th>
            <th className="num"><Tip text="Possessions the NBA charged to this pairing. Under 30 it is left out entirely.">Poss</Tip></th>
            <th className="num"><Tip text="Points he scored against this defender per 100 of those possessions. Comparable across defenders who guarded him for very different stretches.">Pts/100</Tip></th>
            <th className="num"><Tip text="His field goal percentage in those possessions. Blank under 10 attempts, because below that it is a coin flip with a decimal point.">FG%</Tip></th>
            <th className="num">TO</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.thisWeek ? 'hit' : ''}>
                <td>
                  {r.name}
                  {r.team ? <small className="muted"> {r.team}</small> : <small className="muted"> not in the league</small>}
                  {r.thisWeek && <span className="tag info">this week</span>}
                </td>
                <td className="num">{fmt(r.poss, 0)}</td>
                <td className="num strong">{fmt(r.pts100, 1)}</td>
                <td className="num">{r.fg == null ? '–' : fmt(r.fg * 100, 0)}</td>
                <td className="num">{fmt(r.tov, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small className="muted">
        {ctx.matchups?.season} regular season, {ctx.matchups?.min_poss}+ possessions, his {ctx.matchups?.top_n} most frequent defenders.
      </small>
    </>
  )
}

// Flagrant fouls and double technicals name both men. Single technicals name only one, so
// they are counted and never paired. Nothing here touches a projection.
function Friction({ ctx, p }) {
  const rows = frictionFor(ctx.friction, p.name)
  if (!rows.length) return null
  return (
    <>
      <h3>History with</h3>
      <ul className="take">
        {rows.map((r) => (
          <li key={r.name}>
            <b>{r.name}</b> — {Object.entries(r.kinds).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ')}
            {r.last && <span className="muted">, last on {r.last}</span>}
          </li>
        ))}
      </ul>
      <small className="muted">
        Both men named in the same flagrant foul or double technical, {ctx.friction?.season}. This
        changes no number in the app — there is no honest way to price a grudge. It is here to read.
      </small>
    </>
  )
}

export function PlayerDrawer({ ctx, p, onClose }) {
  const [press, setPress] = useState(null)
  const ref = useRef(null)
  useEffect(() => { setPress(null); if (ref.current) ref.current.scrollTop = 0 }, [p.id])
  // Focus moves into the panel on open and back to whatever opened it on close.
  useEffect(() => {
    const back = document.activeElement
    ref.current?.focus({ preventScroll: true })
    return () => { if (back?.isConnected) back.focus({ preventScroll: true }) }
  }, [])
  // Esc closes; Tab stays inside the panel. Both skip when focus sits elsewhere (the ⌘K finder on top, a toast).
  useEffect(() => {
    const k = (e) => {
      const el = ref.current; const a = document.activeElement
      if (!el || !(el.contains(a) || a === document.body)) return
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab') return
      const f = el.querySelectorAll('button:not(:disabled), a[href], input, [tabindex="0"]')
      if (!f.length) return
      if (e.shiftKey && (a === f[0] || a === el)) { e.preventDefault(); f[f.length - 1].focus() }
      else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
    }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [onClose])
  const v = ctx.values.get(p.id)
  const inj = ctx.injuryBy.get(p.id)
  const news = ctx.newsBy.get(p.id) || []
  const owner = ctx.mineSet.has(p.id) ? 'mine' : ctx.takenSet.has(p.id) ? 'taken' : 'free'
  const pts = ctx.settings.format === 'points'
  const loadPress = () => {
    setPress('loading')
    fetch(`/api/news?player=${encodeURIComponent(p.name)}`).then((r) => r.json())
      .then((j) => setPress(j.news.map((n) => ({ ...n, tags: tagNews(n.title) })))).catch(() => setPress([]))
  }
  const facts = [
    v && ['Value', fmt(v.val), 'How much better he is than the best free agent. 0 = anyone could replace him.'],
    v && ['Rank', `#${v.rank}`, 'Where his value ranks among all players right now.'],
    v && pts && ['Pts / game', fmt(v.fp), 'Fantasy points he should score per game in your league.'],
    p.adp && ['Drafted', `~#${Math.round(p.adp)}`, 'Where managers usually pick him in ESPN drafts.'],
  ].filter(Boolean)
  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={(e) => e.stopPropagation()}>
        <header className="dhead">
          <div className="dtitle">
            <h2 id="drawer-title">{p.name} <StatusBadge ctx={ctx} p={p} /> <FlagBadge ctx={ctx} p={p} /></h2>
            <div className="muted">{ctx.teams[p.team]?.name || 'Free agent'} · {p.pos.join('/')}</div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close player panel">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>

        {facts.length > 0 && (
          <dl className="dfacts">
            {facts.map(([k, val, why]) => <div key={k} title={why}><dt>{k}</dt><dd className="num">{val}</dd></div>)}
          </dl>
        )}

        <div className="downer">
          <span id="owner-label">Where is he?</span>
          <div className="seg" role="group" aria-labelledby="owner-label">
            {OWNERS.map(([k, label]) => (
              <button key={k} className={owner === k ? 'on' : ''} aria-pressed={owner === k} onClick={() => ctx.moveTo(p.id, k)}>{label}</button>
            ))}
          </div>
        </div>

        {inj && <div className={`banner ${inj.status === 'Out' ? 'bad' : 'warn'}`}><b>{inj.status}:</b> {inj.comment}</div>}

        <section className="dtake">
          <h3>The short version</h3>
          <ul className="take">{plainTake(ctx, p).map((t, i) => <li key={i}>{t}</li>)}</ul>
        </section>

        {v && ctx.settings.format === 'cats' && <>
          <h3>Category by category</h3>
          <div className="catbars">
            {CATS.map((c) => (
              <div key={c.k} className={ctx.settings.punt.includes(c.k) ? 'punted' : ''}>
                <span>{c.label}</span>
                <div className="bar"><i style={{ [v.z[c.k] >= 0 ? 'left' : 'right']: '50%', width: `${Math.min(50, Math.abs(v.z[c.k]) * 20)}%`, background: v.z[c.k] >= 0 ? 'var(--good)' : 'var(--bad)' }} /></div>
                <span className="num">{fmt(v.z[c.k])}</span>
              </div>
            ))}
          </div>
        </>}

        <h3>Stats per game</h3>
        <div className="scroll dstats">
          <table className="t small">
            <thead><tr><th>Stretch</th>{STAT_HEAD.map(([k, t]) => <th key={k} className="num" title={t}>{k}</th>)}</tr></thead>
            <tbody>
              {LINE_ROWS.map(([k, label]) => {
                const l = p.stats[k]; if (!l) return null
                return <tr key={k}><td>{label}</td>{['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tpm'].map((s) => <td key={s} className="num">{fmt(l[s])}</td>)}
                  <td className="num">{l.fga ? fmt((l.fgm / l.fga) * 100, 0) : '–'}</td><td className="num">{l.fta ? fmt((l.ftm / l.fta) * 100, 0) : '–'}</td><td className="num">{fmt(l.to)}</td><td className="num">{fmt(l.gp, 0)}</td></tr>
              })}
            </tbody>
          </table>
        </div>

        <Guards ctx={ctx} p={p} />
        <Friction ctx={ctx} p={p} />

        <h3>Latest news</h3>
        {news.length ? <ul className="newslist">{news.map((n, i) => <NewsItem key={i} n={n} ctx={ctx} />)}</ul> : <p className="muted">No fantasy news on him in the current feed.</p>}
        <button className="btn ghost" onClick={loadPress} disabled={press === 'loading'}>
          {press === 'loading' ? 'Searching…' : 'Search all press from the last 14 days (on and off the court)'}
        </button>
        {Array.isArray(press) && (press.length
          ? <ul className="newslist">{press.map((n, i) => <NewsItem key={i} n={n} ctx={ctx} />)}</ul>
          : <p className="muted">Nothing found.</p>)}

        {p.outlook && <><h3>Season outlook (ESPN)</h3><p className="outlook">{p.outlook}</p></>}
      </aside>
    </div>
  )
}

// ⌘K / "/" finder: jump to any player's panel or any page. Filters itself so 450 players stay fast.
export function PlayerFinder({ ctx, open, setOpen, pages }) {
  const [q, setQ] = useState('')
  useEffect(() => { if (!open) setQ('') }, [open])
  const term = q.trim().toLowerCase()
  const val = (p) => ctx.values.get(p.id)?.val ?? -99
  const hits = term
    ? ctx.players.filter((p) => p.name.toLowerCase().includes(term)).sort((a, b) => val(b) - val(a)).slice(0, 30)
    : ctx.myPlayers.slice(0, 13)
  const pageHits = pages.filter(([, label]) => term && label.toLowerCase().includes(term))
  const go = (fn) => { setOpen(false); fn() }
  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Find a player or page" shouldFilter={false} loop
      overlayClassName="cmdk-scrim" contentClassName="cmdk">
      <Command.Input value={q} onValueChange={setQ} placeholder="Find a player or page" />
      <Command.List>
        <Command.Empty>{term ? 'No player by that name.' : 'Type a player name.'}</Command.Empty>
        {pageHits.length > 0 && (
          <Command.Group heading="Pages">
            {pageHits.map(([k, label]) => <Command.Item key={k} value={`page-${k}`} onSelect={() => go(() => { location.hash = k })}><span className="grow"><b>{label}</b></span><small>page</small></Command.Item>)}
          </Command.Group>
        )}
        {hits.length > 0 && (
          <Command.Group heading={term ? 'Players' : 'Your team'}>
            {hits.map((p) => {
              const owner = ctx.mineSet.has(p.id) ? 'mine' : ctx.takenSet.has(p.id) ? 'taken' : null
              return (
                <Command.Item key={p.id} value={String(p.id)} onSelect={() => go(() => ctx.open(p.id))}>
                  <span className="grow"><b>{p.name}</b><small>{ctx.teams[p.team]?.abbrev || 'FA'} · {p.pos.join('/')}</small></span>
                  {owner && <span className={`own ${owner}`}>{owner === 'mine' ? 'yours' : 'taken'}</span>}
                  <StatusBadge ctx={ctx} p={p} />
                  <span className="num muted">{fmt(ctx.values.get(p.id)?.val)}</span>
                </Command.Item>
              )
            })}
          </Command.Group>
        )}
      </Command.List>
      <div className="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
    </Command.Dialog>
  )
}
