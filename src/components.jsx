import React, { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import { CATS, etToday, gamesBetween, tagNews, weekBounds } from './lib/model.js'

export const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : x.toFixed(d))
export const ago = (iso) => {
  const h = (Date.now() - new Date(iso)) / 36e5
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`
}

export function Tip({ children, text }) {
  return <span className="tip" title={text} tabIndex={0} data-tip={text}>{children}</span>
}

export function StatusBadge({ ctx, p }) {
  const st = ctx.status(p)
  if (st === 'ok') return null
  const rep = ctx.injuryBy.get(p.id)
  const label = st === 'out' ? (p.inj === 'SUSPENSION' ? 'SUSP' : 'OUT') : 'GTD'
  return <Tip text={rep?.comment || `ESPN status: ${p.inj.replace(/_/g, ' ').toLowerCase()}`}><span className={`badge ${st}`}>{label}</span></Tip>
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

export function PlayerDrawer({ ctx, p, onClose }) {
  const [press, setPress] = useState(null)
  useEffect(() => { setPress(null) }, [p.id])
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [onClose])
  const v = ctx.values.get(p.id)
  const inj = ctx.injuryBy.get(p.id)
  const news = ctx.newsBy.get(p.id) || []
  const owner = ctx.mineSet.has(p.id) ? 'mine' : ctx.takenSet.has(p.id) ? 'taken' : 'free'
  const loadPress = () => {
    setPress('loading')
    fetch(`/api/news?player=${encodeURIComponent(p.name)}`).then((r) => r.json())
      .then((j) => setPress(j.news.map((n) => ({ ...n, tags: tagNews(n.title) })))).catch(() => setPress([]))
  }
  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
        <h2>{p.name} <StatusBadge ctx={ctx} p={p} /></h2>
        <div className="muted">{ctx.teams[p.team]?.name || 'Free agent'} · {p.pos.join('/')}{v && <> · Value {fmt(v.val)} · Rank #{v.rank}</>}</div>
        <div className="seg">
          {[['mine', 'On my team'], ['taken', 'On another team'], ['free', 'Available']].map(([k, label]) => (
            <button key={k} className={owner === k ? 'on' : ''} onClick={() => ctx.setOwner(p.id, k)}>{label}</button>
          ))}
        </div>
        {inj && <div className={`banner ${inj.status === 'Out' ? 'bad' : 'warn'}`}><b>{inj.status}:</b> {inj.comment}</div>}
        <ul className="take">{plainTake(ctx, p).map((t, i) => <li key={i}>{t}</li>)}</ul>

        {v && ctx.settings.format === 'cats' && (
          <div className="catbars">
            {CATS.map((c) => (
              <div key={c.k} className={ctx.settings.punt.includes(c.k) ? 'punted' : ''}>
                <span>{c.label}</span>
                <div className="bar"><i style={{ [v.z[c.k] >= 0 ? 'left' : 'right']: '50%', width: `${Math.min(50, Math.abs(v.z[c.k]) * 20)}%`, background: v.z[c.k] >= 0 ? 'var(--good)' : 'var(--bad)' }} /></div>
                <span className="num">{fmt(v.z[c.k])}</span>
              </div>
            ))}
          </div>
        )}

        <div className="scroll">
          <table className="t small">
            <thead><tr><th>Per game</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>3PM</th><th>FG%</th><th>FT%</th><th>TO</th><th>GP</th></tr></thead>
            <tbody>
              {LINE_ROWS.map(([k, label]) => {
                const l = p.stats[k]; if (!l) return null
                return <tr key={k}><td>{label}</td>{['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tpm'].map((s) => <td key={s} className="num">{fmt(l[s])}</td>)}
                  <td className="num">{l.fga ? fmt((l.fgm / l.fga) * 100, 0) : '–'}</td><td className="num">{l.fta ? fmt((l.ftm / l.fta) * 100, 0) : '–'}</td><td className="num">{fmt(l.to)}</td><td className="num">{fmt(l.gp, 0)}</td></tr>
              })}
            </tbody>
          </table>
        </div>

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
