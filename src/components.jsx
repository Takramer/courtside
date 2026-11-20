import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'cmdk'
import { CATS, etToday, fantasyPoints, gamesBetween, tagNews, weekBounds } from './lib/model.js'
import { BarList, WeekStrip } from './charts.jsx'

// A true minus, and no '-0.0': a value that rounds to zero prints as zero.
export const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : (Math.abs(x) < 0.5 / 10 ** d ? 0 : x).toFixed(d).replace('-', '−'))
// Signed: '+' only when the printed value is above zero.
export const sfmt = (x, d = 1) => (x != null && Math.abs(x) >= 0.5 / 10 ** d && x > 0 ? '+' : '') + fmt(x, d)
export const ago = (iso) => {
  const h = (Date.now() - new Date(iso)) / 36e5
  return `${h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`}\u00a0ago`
}

// Value's heat. Linear opacity made everyone below about a third of the best player look
// identically black, so the curve lifts the low end: 1.9 and 11.9 are both "replaceable",
// but only one of them is nearly worthless. Gamma 0.6, ceiling 0.5.
export const heat = (val, max) => ({ '--o': (Math.max(0, val ?? 0) / (max || 1)) ** 0.6 * 0.5 })

// Shows on hover, keyboard focus and tap (a tap focuses it). The text sits in a hidden span
// the anchor points at, so screen readers hear it; the visible copy is portalled to <body>
// so the scrolling panes and tables cannot clip it.
export function Tip({ children, text }) {
  const id = useId()
  const [at, setAt] = useState(null)
  const hide = () => setAt(null)
  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const left = Math.min(Math.max(r.left + r.width / 2, 140), innerWidth - 140)
    setAt(r.bottom + 90 > innerHeight ? { left, bottom: innerHeight - r.top + 6 } : { left, top: r.bottom + 6 })
    addEventListener('scroll', hide, { capture: true, once: true })
  }
  return (
    <span className="tip" tabIndex={0} aria-describedby={id} onMouseEnter={show} onMouseLeave={hide}
      onFocus={show} onBlur={hide} onKeyDown={(e) => e.key === 'Escape' && hide()}>
      {children}
      <span id={id} hidden>{text}</span>
      {at && createPortal(<span className="tip-pop" aria-hidden="true" style={at}>{text}</span>, document.body)}
    </span>
  )
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
  const text = `${flags.map((f) => f.title).join(' · ')} (not in any projection)`
  return <Tip text={text}><span className="badge flag">{kinds.includes('legal') ? 'LEGAL' : 'OFF-COURT'}</span></Tip>
}

export function PlayerName({ ctx, p, sub = true }) {
  const team = ctx.teams[p.team]
  const fresh = (ctx.newsBy.get(p.id) || []).some((n) => Date.now() - new Date(n.date) < 36e5 * 24)
  return (
    <span className="pname">
      <button className="link" onClick={() => ctx.open(p.id)}>{p.name}</button>
      <StatusBadge ctx={ctx} p={p} />
      {fresh && <Tip text="News in the last 24 hours"><span className="dot" /></Tip>}
      {sub && <small>{team?.abbrev || 'FA'} · {p.pos.join('/')}</small>}
    </span>
  )
}

export function ZCell({ z }) {
  const c = Math.max(-2.5, Math.min(2.5, z ?? 0)) / 2.5
  // The app's own green and red, not a framework's: a z-cell is the same good and bad as every badge.
  const bg = c >= 0 ? `rgba(79,180,119,${c * 0.5})` : `rgba(217,83,76,${-c * 0.5})`
  return <td className="num z" style={{ background: bg }}>{fmt(z, 1)}</td>
}

export const catHeaders = (settings) => CATS.filter((c) => !settings.punt.includes(c.k))

export const ValueTip = ({ settings }) => (
  <Tip text={settings.format === 'points' ? 'Points a game above a waiver pickup' : 'Category score above a waiver pickup'}>Value</Tip>
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
  const all = gamesBetween(ctx.teams[p.team], a, b).length
  const left = gamesBetween(ctx.teams[p.team], etToday(), b).length
  out.push(`${all} game${all === 1 ? '' : 's'} this week, ${left} still to play.`)
  if (p.adp) out.push(`Fantasy managers usually draft him around pick #${Math.round(p.adp)}; on ${fmt(p.own, 0)}% of ESPN teams.`)
  return out
}

const LINE_ROWS = [['proj', 'Projected'], ['cur', 'This season so far'], ['l15', 'Last 15 days'], ['last', 'Last season']]
// The same stretches in the order they happened, for the bar chart: read top to bottom it is
// the direction he is heading.
const STRETCHES = [['last', 'Last season'], ['proj', 'Projected'], ['cur', 'This season'], ['l15', 'Last 15 days']]

// Fantasy points a game in each stretch, in this league's scoring. The latest stretch is the
// one lit; the others are the baseline it is read against.
function Stretches({ ctx, p }) {
  const rows = STRETCHES.filter(([k]) => p.stats[k]?.gp > 0 || (k === 'proj' && p.stats[k]))
    .map(([k, label]) => ({ key: k, label, value: fantasyPoints(p.stats[k], ctx.settings.weights), sub: k === 'proj' ? '' : `${Math.round(p.stats[k].gp)}g` }))
  if (rows.length < 2) return null
  const latest = rows[rows.length - 1]
  const proj = rows.find((r) => r.key === 'proj')
  const diff = proj && latest.key !== 'proj' ? latest.value - proj.value : null
  return (
    <>
      <h3>Fantasy points a game</h3>
      <BarList rows={rows} hi={latest.key} />
      {diff != null && Math.abs(diff) >= 1 && (
        <p className="note">{latest.label}: {diff > 0 ? '+' : '\u2212'}{fmt(Math.abs(diff))} a game against projection</p>
      )}
    </>
  )
}

// The stats the scoring leans on, nothing else: eight numbers fit the panel at every width
// without a sideways scroll.
const STAT_HEAD = [['pts', 'PTS', 'Points'], ['reb', 'REB', 'Rebounds'], ['ast', 'AST', 'Assists'], ['stl', 'STL', 'Steals'], ['blk', 'BLK', 'Blocks'], ['to', 'TO', 'Turnovers (lower is better)'], ['tpm', '3PM', '3-pointers made'], ['min', 'MIN', 'Minutes']]
const OWNERS = [['mine', 'On my team'], ['taken', 'Another team'], ['free', 'Available']]

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
    v && ['Value', fmt(v.val), 'Points a game above a waiver pickup'],
    v && ['Rank', `#${v.rank}`, 'Rank by value'],
    v && pts && ['Pts a game', fmt(v.fp), 'Projected fantasy points a game'],
    p.adp && ['Drafted', `#${Math.round(p.adp)}`, 'Average ESPN draft pick'],
  ].filter(Boolean)
  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={(e) => e.stopPropagation()}>
        <header className="dhead">
          <div className="dtitle">
            <h2 id="drawer-title">{p.name} <StatusBadge ctx={ctx} p={p} /> <FlagBadge ctx={ctx} p={p} /></h2>
            <div className="muted">{ctx.teams[p.team]?.name || 'Free agent'} · {p.pos.join('/')}</div>
            {ctx.teams[p.team] && <div className="dweek"><span className="muted">This week</span><WeekStrip team={ctx.teams[p.team]} teams={ctx.teams} mon={weekBounds(etToday())[0]} today={etToday()} /></div>}
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
          <span id="owner-label">Owner</span>
          <div className="seg" role="group" aria-labelledby="owner-label">
            {OWNERS.map(([k, label]) => (
              <button key={k} className={owner === k ? 'on' : ''} aria-pressed={owner === k} onClick={() => ctx.moveTo(p.id, k)}>{label}</button>
            ))}
          </div>
        </div>

        {inj && <div className={`banner ${inj.status === 'Out' ? 'bad' : 'warn'}`}><b>{inj.status}:</b> {inj.comment}</div>}

        <section className="dtake">
          <h3>Summary</h3>
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

        {ctx.settings.format === 'points' && <Stretches ctx={ctx} p={p} />}

        <h3>Stats per game</h3>
        <div className="dstats">
          <table className="t small">
            <thead><tr><th>Stretch</th>{STAT_HEAD.map(([k, h, t]) => <th key={k} className="num" title={t}>{h}</th>)}</tr></thead>
            <tbody>
              {LINE_ROWS.map(([k, label]) => {
                const l = p.stats[k]; if (!l) return null
                return <tr key={k}><td>{label}</td>{STAT_HEAD.map(([s, h]) => <td key={s} className="num" data-h={h}>{fmt(l[s])}</td>)}</tr>
              })}
            </tbody>
          </table>
        </div>

        <h3>Latest news</h3>
        {news.length ? <ul className="newslist">{news.map((n, i) => <NewsItem key={i} n={n} ctx={ctx} />)}</ul> : <p className="muted">No news in the feed.</p>}
        <button className="btn ghost" onClick={loadPress} disabled={press === 'loading'}>
          {press === 'loading' ? 'Searching…' : 'Search the press, last 14 days'}
        </button>
        {Array.isArray(press) && (press.length
          ? <ul className="newslist">{press.map((n, i) => <NewsItem key={i} n={n} ctx={ctx} />)}</ul>
          : <p className="muted">Nothing found.</p>)}

        {p.outlook && <details className="outlook"><summary>ESPN season outlook</summary><p>{p.outlook}</p></details>}
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
                  {owner && term && <span className={`own ${owner}`}>{owner === 'mine' ? 'yours' : 'taken'}</span>}
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
