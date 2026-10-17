import React, { useEffect, useMemo, useState } from 'react'
import { useFetch, useLocal } from './lib/store.js'
import { computeValues, DEFAULT_SETTINGS, normName, tagNews } from './lib/model.js'
import { PlayerDrawer } from './components.jsx'
import Today from './pages/Today.jsx'
import Draft from './pages/Draft.jsx'
import Team from './pages/Team.jsx'
import Waivers from './pages/Waivers.jsx'
import Trade from './pages/Trade.jsx'
import News from './pages/News.jsx'
import League from './pages/League.jsx'
import Learn from './pages/Learn.jsx'

const TABS = [
  ['today', 'Today', Today],
  ['draft', 'Draft', Draft],
  ['team', 'My team', Team],
  ['waivers', 'Waivers', Waivers],
  ['trade', 'Trade', Trade],
  ['news', 'News', News],
  ['league', 'League setup', League],
  ['learn', 'Learn', Learn],
]

const useHash = () => {
  const get = () => location.hash.slice(1) || 'today'
  const [h, setH] = useState(get)
  useEffect(() => { const f = () => setH(get()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return h
}

export default function App() {
  const tab = useHash()
  const pdata = useFetch('/api/players')
  const ndata = useFetch('/api/news')
  const [settings, setSettings] = useLocal('cs.settings', DEFAULT_SETTINGS)
  const [mine, setMine] = useLocal('cs.mine', [])
  const [taken, setTaken] = useLocal('cs.taken', [])
  const [openId, setOpenId] = useState(null)

  const s = { ...DEFAULT_SETTINGS, ...settings }
  const players = pdata.data?.players || []
  const teams = pdata.data?.teams || {}
  const values = useMemo(() => (players.length ? computeValues(players, s) : new Map()), [players, JSON.stringify(s)])
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])

  // Attach news + injury report to players: RotoWire by name, ESPN by athlete id.
  const { newsBy, injuryBy } = useMemo(() => {
    const idByName = new Map(players.map((p) => [normName(p.name), p.id]))
    const newsBy = new Map(); const injuryBy = new Map()
    const push = (id, item) => { if (!newsBy.has(id)) newsBy.set(id, []); newsBy.get(id).push(item) }
    for (const n of ndata.data?.news || []) {
      const item = { ...n, tags: tagNews(`${n.title} ${n.body}`) }
      const ids = n.ids?.length ? n.ids.filter((id) => byId.has(id)) : [idByName.get(normName(n.name))].filter(Boolean)
      ids.forEach((id) => push(id, item))
    }
    for (const i of ndata.data?.injuries || []) {
      const id = idByName.get(normName(i.name)); if (id) injuryBy.set(id, i)
    }
    return { newsBy, injuryBy }
  }, [ndata.data, players, byId])

  const mineSet = new Set(mine); const takenSet = new Set(taken)
  const status = (p) => {
    const rep = injuryBy.get(p.id)?.status
    if (rep === 'Out' || p.inj === 'OUT' || p.inj === 'SUSPENSION' || p.inj === 'INJURY_RESERVE') return 'out'
    if (rep === 'Day-To-Day' || ['DAY_TO_DAY', 'QUESTIONABLE', 'DOUBTFUL'].includes(p.inj)) return 'dtd'
    return 'ok'
  }
  const setOwner = (id, who) => {
    setMine((m) => (who === 'mine' ? [...new Set([...m, id])] : m.filter((x) => x !== id)))
    setTaken((t) => (who === 'taken' ? [...new Set([...t, id])] : t.filter((x) => x !== id)))
  }

  // After a full draft we know exactly who is taken; before that, guess from ESPN ownership.
  const exactTaken = taken.length >= (s.teams - 1) * s.rosterSize * 0.8
  const isFree = (p) => !mineSet.has(p.id) && !takenSet.has(p.id) && (exactTaken || p.own < s.ownCutoff)

  const ctx = {
    isFree, exactTaken,
    players, byId, teams, values, settings: s, setSettings, mine, setMine, taken, setTaken, mineSet, takenSet,
    newsBy, injuryBy, status, setOwner, open: setOpenId, newsUpdated: ndata.data?.updated,
    myPlayers: mine.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => (values.get(b.id)?.val ?? -99) - (values.get(a.id)?.val ?? -99)),
  }
  const Page = (TABS.find((t) => t[0] === tab) || TABS[0])[2]

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#today"><span className="ball" />Courtside</a>
        <nav>
          {TABS.map(([k, label]) => <a key={k} href={`#${k}`} className={tab === k ? 'on' : ''}>{label}</a>)}
        </nav>
      </header>
      <main>
        {pdata.error && <div className="banner bad">Could not load player data: {pdata.error}. Refresh in a minute.</div>}
        {!pdata.data && !pdata.error ? <div className="loading">Loading 450+ players, schedules and news…</div> : players.length > 0 && <Page ctx={ctx} />}
      </main>
      {openId && byId.get(openId) && <PlayerDrawer ctx={ctx} p={byId.get(openId)} onClose={() => setOpenId(null)} />}
      <footer>Data: ESPN fantasy projections and stats, ESPN injury report, RotoWire and Google News. Updated {pdata.data ? new Date(pdata.data.updated).toLocaleTimeString() : '…'}.</footer>
    </div>
  )
}
