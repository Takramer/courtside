import React, { useEffect, useMemo, useState } from 'react'
import { useFetch, useLocal } from './lib/store.js'
import { useEspnLeague } from './lib/espn.js'
import { computeValues, DEFAULT_ROSTER, DEFAULT_SETTINGS, normName, tagNews } from './lib/model.js'
import { Toaster, toast } from 'sonner'
import { PlayerDrawer, PlayerFinder } from './components.jsx'
import Team from './pages/Team.jsx'
import Matchup from './pages/Matchup.jsx'
import Waivers from './pages/Waivers.jsx'
import Trade from './pages/Trade.jsx'
import News from './pages/News.jsx'
import League from './pages/League.jsx'
import Learn from './pages/Learn.jsx'

const TABS = [
  ['team', 'My team', Team],
  ['week', 'This week', Matchup],
  ['waivers', 'Waivers', Waivers],
  ['trade', 'Trade', Trade],
  ['news', 'News', News],
  ['league', 'League setup', League],
  ['learn', 'Learn', Learn],
]

const OWNER_MSG = { mine: 'added to your team', taken: 'marked taken by another team', free: 'marked available' }
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function Loading() {
  return (
    <div className="skel" aria-busy="true">
      <i className="h" /><i className="l" />
      <div className="row3"><i className="c" /><i className="c" /><i className="c" /></div>
      <i /><i /><i className="l" /><i /><i className="l" />
      <p>Loading 450+ players, schedules and news…</p>
    </div>
  )
}

const useHash = () => {
  const get = () => location.hash.slice(1) || 'team'
  const [h, setH] = useState(get)
  useEffect(() => { const f = () => setH(get()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return h
}

export default function App() {
  const tab = useHash()
  const pdata = useFetch('/api/players')
  const ndata = useFetch('/api/news')
  // v3: the real ESPN slots (PF/C, two UT) replace the old three-UT guess; a new key drops the settings saved under it
  const [settings, setSettings] = useLocal('cs.settings.v3', DEFAULT_SETTINGS)
  const [mine, setMine] = useLocal('cs.mine', [])
  const [taken, setTaken] = useLocal('cs.taken', [])
  const [rosterLoaded, setRosterLoaded] = useLocal('cs.roster.drafted', false)
  const [espn, setEspn] = useLocal('cs.espn', { league: '', s2: '', swid: '', team: null })
  const league = useEspnLeague(espn.league ? espn : null)
  const [openId, setOpenId] = useState(null)
  const [finding, setFinding] = useState(false)

  // ⌘K / Ctrl+K anywhere, or "/" when not typing, opens the player finder.
  useEffect(() => {
    const k = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); setFinding((f) => !f) }
    }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])

  const s = { ...DEFAULT_SETTINGS, ...settings }
  const players = pdata.data?.players || []
  // Connected: every roster in the league comes from ESPN, so an add or drop there shows up here on the next load.
  const linked = !!(league.at && espn.team && league.rosters[espn.team])
  useEffect(() => {
    if (!linked || !players.length) return
    const known = (ids) => ids.filter((id) => byId.has(id))
    setMine(known(league.rosters[espn.team]))
    setTaken(known(Object.entries(league.rosters).filter(([id]) => +id !== espn.team).flatMap(([, ids]) => ids)))
  }, [league.at, espn.team, players])

  // Not connected, first visit: load the team he drafted. After that the app's own Add and Drop are the record.
  useEffect(() => {
    if (linked || rosterLoaded || !players.length) return
    const idByName = new Map(players.map((p) => [normName(p.name), p.id]))
    const ids = DEFAULT_ROSTER.map((n) => idByName.get(normName(n))).filter(Boolean)
    if (ids.length) setMine(ids)
    setRosterLoaded(true)
  }, [players, rosterLoaded])
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
  // setOwner plus a toast that can put the player back where he was. Draft keeps its own log, so it calls setOwner directly.
  const moveTo = (id, who) => {
    const prev = mineSet.has(id) ? 'mine' : takenSet.has(id) ? 'taken' : 'free'
    if (prev === who) return
    setOwner(id, who)
    toast(`${byId.get(id)?.name ?? 'Player'} ${OWNER_MSG[who]}`, { action: { label: 'Undo', onClick: () => setOwner(id, prev) } })
  }

  // Connected, ESPN names the free agents in this league outright. Otherwise: anyone unmarked who few leagues own.
  const freeIds = linked && league.freeIds ? new Set(league.freeIds) : null
  const exactTaken = !!freeIds || taken.length >= (s.teams - 1) * s.rosterSize * 0.8
  const isFree = (p) => (freeIds ? freeIds.has(p.id) : !mineSet.has(p.id) && !takenSet.has(p.id) && (exactTaken || p.own < s.ownCutoff))

  const ctx = {
    isFree, exactTaken, espn, setEspn, league, linked,
    players, byId, teams, values, settings: s, setSettings, mine, setMine, taken, setTaken, mineSet, takenSet,
    newsBy, injuryBy, status, setOwner, moveTo, toast, open: setOpenId, find: () => setFinding(true), newsUpdated: ndata.data?.updated,
    myPlayers: mine.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => (values.get(b.id)?.val ?? -99) - (values.get(a.id)?.val ?? -99)),
  }
  const Page = (TABS.find((t) => t[0] === tab) || TABS[0])[2]

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#team"><span className="ball" />Courtside</a>
        <nav>
          {TABS.map(([k, label]) => <a key={k} href={`#${k}`} className={tab === k ? 'on' : ''}>{label}</a>)}
        </nav>
        <button className="findbtn" onClick={() => setFinding(true)} aria-label="Find a player">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <span>Find a player</span><kbd>{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
      </header>
      <main>
        {pdata.error && <div className="banner bad">Could not load player data: {pdata.error}. Refresh in a minute.</div>}
        {!pdata.data && !pdata.error ? <Loading /> : players.length > 0 && <Page ctx={ctx} />}
      </main>
      {players.length > 0 && <PlayerFinder ctx={ctx} open={finding} setOpen={setFinding} pages={TABS} />}
      <Toaster theme="dark" position="bottom-center" offset={20} toastOptions={{ className: 'toast' }} />
      {openId && byId.get(openId) && <PlayerDrawer ctx={ctx} p={byId.get(openId)} onClose={() => setOpenId(null)} />}
      <footer>Data: ESPN fantasy projections and stats, ESPN injury report, RotoWire and Google News. Updated {pdata.data ? new Date(pdata.data.updated).toLocaleTimeString() : '…'}.</footer>
    </div>
  )
}
