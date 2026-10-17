import React, { useState } from 'react'
import { NEWS_TAGS } from '../lib/model.js'
import { NewsItem, ago } from '../components.jsx'

export default function News({ ctx }) {
  const [onlyMine, setOnlyMine] = useState(ctx.mine.length > 0)
  const [tag, setTag] = useState(null)
  const seen = new Set()
  const items = []
  for (const [pid, list] of ctx.newsBy) {
    if (onlyMine && !ctx.mineSet.has(pid)) continue
    for (const n of list) {
      const key = `${pid}|${n.title}`
      if (seen.has(key) || (tag && !n.tags.some((t) => t.k === tag))) continue
      seen.add(key); items.push({ ...n, pid })
    }
  }
  items.sort((a, b) => b.date.localeCompare(a.date))
  const injured = ctx.players.filter((p) => ctx.injuryBy.has(p.id) && (!onlyMine || ctx.mineSet.has(p.id)))
    .sort((a, b) => (ctx.values.get(b.id)?.val ?? -99) - (ctx.values.get(a.id)?.val ?? -99)).slice(0, 40)

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>News</h1>
          <p className="lead">Fantasy news, injuries and off-court stories, tagged by what they mean for you. Hover a tag for the plain-English take. Updated {ctx.newsUpdated ? ago(ctx.newsUpdated) : '…'}. For deeper digging, open any player and search all press.</p>
        </div>
      </div>
      <div className="filters">
        <div className="seg">
          <button className={onlyMine ? 'on' : ''} onClick={() => setOnlyMine(true)}>My players</button>
          <button className={!onlyMine ? 'on' : ''} onClick={() => setOnlyMine(false)}>Everyone</button>
        </div>
        <div className="seg">
          <button className={!tag ? 'on' : ''} onClick={() => setTag(null)}>All</button>
          {NEWS_TAGS.map((t) => <button key={t.k} className={tag === t.k ? 'on' : ''} onClick={() => setTag(t.k)} title={t.why}>{t.label}</button>)}
        </div>
      </div>
      <div className="two wide-left">
        <section>
          {items.length ? <ul className="newslist">{items.map((n, i) => <NewsItem key={i} n={n} ctx={ctx} showName />)}</ul>
            : <p className="muted">Nothing here right now{onlyMine ? ' for your players' : ''}.</p>}
        </section>
        <section>
          <h2>Injury report</h2>
          <ul className="plain inj">
            {injured.map((p) => {
              const i = ctx.injuryBy.get(p.id)
              return <li key={p.id}><button className="link" onClick={() => ctx.open(p.id)}>{p.name}</button> <span className={`badge ${i.status === 'Out' ? 'out' : 'dtd'}`}>{i.status}</span><p>{i.comment}</p></li>
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}
