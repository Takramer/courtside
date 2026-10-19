// Player news (RotoWire RSS) + official injury report (ESPN), merged into one payload.
const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .trim()
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] || '')

async function rotowire() {
  const r = await fetch('https://www.rotowire.com/rss/news.php?sport=NBA')
  if (!r.ok) return []
  const xml = await r.text()
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const title = tag(it, 'title')
    const i = title.indexOf(':')
    return {
      name: i > 0 ? title.slice(0, i).trim() : '',
      title: i > 0 ? title.slice(i + 1).trim() : title,
      body: tag(it, 'description').replace(/\s*Visit RotoWire\.com for more analysis on this update\.\s*$/, ''),
      date: new Date(tag(it, 'pubDate')).toISOString(),
      link: tag(it, 'link'),
      src: 'RotoWire',
    }
  })
}

async function injuries() {
  const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries')
  if (!r.ok) return []
  const j = await r.json()
  return (j.injuries || []).flatMap((t) => (t.injuries || []).map((i) => ({
    name: i.athlete?.displayName || '',
    status: i.status,
    comment: i.shortComment || '',
    detail: i.longComment || '',
    date: i.date,
  })))
}

async function espnHeadlines() {
  const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=50')
  if (!r.ok) return []
  const j = await r.json()
  return (j.articles || []).filter((a) => a.type !== 'Media').map((a) => ({
    ids: (a.categories || []).filter((c) => c.type === 'athlete').map((c) => c.athleteId ?? c.athlete?.id),
    name: '',
    title: a.headline,
    body: a.description || '',
    date: a.published,
    link: a.links?.web?.href || '',
    src: 'ESPN',
  }))
}

// Per-player search: recent press about the player, on and off the court.
async function googleNews(name, limit = 25) {
  const q = encodeURIComponent(`"${name}" NBA`)
  const r = await fetch(`https://news.google.com/rss/search?q=${q}+when:14d&hl=en-US&gl=US&ceid=US:en`)
  if (!r.ok) return []
  const xml = await r.text()
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map(([, it]) => {
    const title = tag(it, 'title')
    const outlet = tag(it, 'source')
    return { name, title: title.replace(` - ${outlet}`, ''), body: '', date: new Date(tag(it, 'pubDate')).toISOString(), link: tag(it, 'link'), src: outlet || 'Google News' }
  })
}

// Phase 7: the same search across a roster in one call, so off-court news reaches the app
// without the user having to suspect someone first. Capped and cached — thirteen RSS fetches
// is a second or two, and a hundred would be a different thing.
const SWEEP_MAX = 15

export default async function handler(req, res) {
  const player = String(req.query?.player || '').slice(0, 60)
  if (player) {
    const items = await googleNews(player).catch(() => [])
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600')
    return res.status(200).json({ news: items })
  }

  const sweep = String(req.query?.players || '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, SWEEP_MAX)
  if (sweep.length) {
    // Ten each, not twenty-five. The sweep exists to catch an event, not to be read.
    const got = await Promise.allSettled(sweep.map((n) => googleNews(n, 10)))
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600')
    return res.status(200).json({
      updated: new Date().toISOString(),
      asked: sweep.length,
      // One flat list; each item already carries the name it was searched under, which is
      // how the app joins it back to a player.
      news: got.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
        .sort((a, b) => b.date.localeCompare(a.date)),
    })
  }
  const [rw, espn, inj] = await Promise.allSettled([rotowire(), espnHeadlines(), injuries()])
  const ok = (r) => (r.status === 'fulfilled' ? r.value : [])
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
  res.status(200).json({
    updated: new Date().toISOString(),
    news: [...ok(rw), ...ok(espn)].sort((a, b) => b.date.localeCompare(a.date)),
    injuries: ok(inj),
  })
}
