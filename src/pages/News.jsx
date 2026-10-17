import React, { useState } from 'react'
import { NEWS_TAGS } from '../lib/model.js'
import { NewsItem, ago } from '../components.jsx'
import './extras.css'

export default function News({ ctx }) {
  const [onlyMine, setOnlyMine] = useState(ctx.mine.length > 0)
  const [tag, setTag] = useState(null)
  const seen = new Set()
  const all = []
  for (const [pid, list] of ctx.newsBy) {
    if (onlyMine && !ctx.mineSet.has(pid)) continue
    for (const n of list) {
      const key = `${pid}|${n.title}`
      if (seen.has(key)) continue
      seen.add(key); all.push({ ...n, pid })
    }
  }
  const counts = {}
  for (const n of all) for (const t of n.tags) counts[t.k] = (counts[t.k] || 0) + 1
  const items = tag ? all.filter((n) => n.tags.some((t) => t.k === tag)) : all
  items.sort((a, b) => b.date.localeCompare(a.date))
  const sel = NEWS_TAGS.find((t) => t.k === tag)
  const injured = ctx.players.filter((p) => ctx.injuryBy.has(p.id) && (!onlyMine || ctx.mineSet.has(p.id)))
    .sort((a, b) => (ctx.values.get(b.id)?.val ?? -99) - (ctx.values.get(a.id)?.val ?? -99)).slice(0, 40)
  const outN = injured.filter((p) => ctx.injuryBy.get(p.id).status === 'Out').length

  let empty
  if (!ctx.newsUpdated && !ctx.newsBy.size) empty = <p>Loading news…</p>
  else if (onlyMine && !ctx.mine.length) empty = <><p><b>You have not added any players yet.</b> Add them on <a href="#team">My team</a> to see only their news.</p><button className="btn ghost sm" onClick={() => setOnlyMine(false)}>Show everyone's news</button></>
  else if (tag) empty = <><p><b>No "{sel.label}" stories{onlyMine ? ' about your players' : ''} right now.</b> That is usually good news.</p><button className="btn ghost sm" onClick={() => setTag(null)}>Show all stories</button></>
  else if (onlyMine) empty = <><p><b>No news about your players right now.</b></p><button className="btn ghost sm" onClick={() => setOnlyMine(false)}>Show everyone's news</button></>
  else empty = <p><b>The feed is empty right now.</b> It refreshes each time you open the app.</p>

  return (
    <div className="page newspage">
      <div className="pagehead">
        <div>
          <h1>News</h1>
          <p className="lead">Fantasy news, injuries and off-court stories, tagged by what they mean for you. Updated {ctx.newsUpdated ? ago(ctx.newsUpdated) : '…'}. For deeper digging, open any player and search all press.</p>
        </div>
      </div>

      <div className="nfilters">
        <div className="seg" role="group" aria-label="Whose news">
          <button className={onlyMine ? 'on' : ''} aria-pressed={onlyMine} onClick={() => setOnlyMine(true)}>My players</button>
          <button className={!onlyMine ? 'on' : ''} aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)}>Everyone</button>
        </div>
        <div className="chips" role="group" aria-label="Kind of story">
          <button className={!tag ? 'on' : ''} aria-pressed={!tag} onClick={() => setTag(null)}>All <span className="cnt">{all.length}</span></button>
          {NEWS_TAGS.map((t) => (
            <button key={t.k} className={`${t.tone}${tag === t.k ? ' on' : ''}`} aria-pressed={tag === t.k} onClick={() => setTag(tag === t.k ? null : t.k)} title={t.why}>
              <i className="tone" aria-hidden="true" />{t.label} <span className="cnt">{counts[t.k] || 0}</span>
            </button>
          ))}
        </div>
        <p className="tagwhy">{sel ? <><b>{sel.label}:</b> {sel.why}</> : 'Pick a tag to see one kind of story. Each tag says what the news means for your team.'}</p>
      </div>

      <div className="ngrid">
        <section aria-label="Stories">
          {items.length ? <ul className="newslist">{items.map((n, i) => <NewsItem key={`${n.pid}|${n.title}|${i}`} n={n} ctx={ctx} showName />)}</ul>
            : <div className="empty">{empty}</div>}
        </section>
        <aside className="injcard" aria-labelledby="inj-h">
          <header>
            <h2 id="inj-h">Injury report</h2>
            <small>{outN} out · {injured.length - outN} day-to-day</small>
          </header>
          <p className="legend"><span className="badge out">Out</span> will not play. <span className="badge dtd">Day-to-day</span> might play; check an hour before the game.</p>
          {injured.length ? (
            <ul>
              {injured.map((p) => {
                const i = ctx.injuryBy.get(p.id)
                return (
                  <li key={p.id}>
                    <div className="injrow">
                      <button className="link" onClick={() => ctx.open(p.id)}>{p.name}</button>
                      <small>{ctx.teams[p.team]?.abbrev || 'FA'}</small>
                      <span className={`badge ${i.status === 'Out' ? 'out' : 'dtd'}`}>{i.status}</span>
                    </div>
                    <p>{i.comment}</p>
                  </li>
                )
              })}
            </ul>
          ) : <p className="empty">{!ctx.injuryBy.size ? 'Loading the injury report…' : onlyMine && !ctx.mine.length ? 'Add players on My team to see their injuries here.' : `No one${onlyMine ? ' on your team' : ''} is on the report.`}</p>}
        </aside>
      </div>
    </div>
  )
}
