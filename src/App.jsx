import React, { useEffect, useMemo, useState } from 'react'
import { useFetch, useLocal } from './lib/store.js'
import { useEspnLeague, useHistory, useMatchup } from './lib/espn.js'
import { clearToken, tokenInUrl, unpack } from './lib/link.js'
import { computeValues, DEFAULT_ROSTER, DEFAULT_SETTINGS, etToday, normName, splitIR, tagNews, weekBounds } from './lib/model.js'
import { availability } from './lib/predict.js'
import { recordWeek, score, settle, spreadScale } from './lib/grade.js'
import { Toaster, toast } from 'sonner'
import { PlayerDrawer, PlayerFinder } from './components.jsx'
import { weekOdds } from './pages/today.js'
import Today from './pages/Today.jsx'
import Team from './pages/Team.jsx'
import Matchup from './pages/Matchup.jsx'
import Waivers from './pages/Waivers.jsx'
import Trade from './pages/Trade.jsx'
import League from './pages/League.jsx'

// hash, label, page. Setup sits last; on a phone it leaves the tab bar for the header's gear.
const TABS = [
  ['today', 'Today', Today],
  ['team', 'Roster', Team],
  ['week', 'Matchup', Matchup],
  ['waivers', 'Waivers', Waivers],
  ['trade', 'Trade', Trade],
  ['league', 'Setup', League],
]
// Pages that no longer exist land on the nearest one that does.
const MOVED = { news: 'today', scorecard: 'week', '': 'today' }
const SEASON_TAG = '2026-27'
const OWNER_MSG = { mine: 'added to your team', taken: 'marked taken by another team', free: 'marked available' }
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const route = () => {
  const h = location.hash.slice(1)
  if (h.startsWith('link=')) return 'league'
  return TABS.some((t) => t[0] === h) ? h : MOVED[h] ?? 'today'
}
const useHash = () => {
  const [h, setH] = useState(route)
  useEffect(() => {
    const f = () => {
      const r = route()
      const raw = location.hash.slice(1)
      if (raw !== r && !raw.startsWith('link=')) history.replaceState(null, '', `#${r}`)
      setH(r)
    }
    f()
    addEventListener('hashchange', f); return () => removeEventListener('hashchange', f)
  }, [])
  return h
}

// Under 900px the page tabs are a bar along the bottom of the screen. The nav then follows
// the header in the DOM, so Tab runs brand, Find, Setup, tab bar: the order on screen.
const NARROW = '(max-width: 899px)'
const useNarrow = () => {
  const [n, setN] = useState(() => matchMedia(NARROW).matches)
  useEffect(() => {
    const m = matchMedia(NARROW); const f = () => setN(m.matches)
    m.addEventListener('change', f); return () => m.removeEventListener('change', f)
  }, [])
  return n
}

const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
)
const GearIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
)

function Loading() {
  return (
    <div className="skel" aria-busy="true">
      <i className="h" /><i className="l" /><i /><i /><i className="l" /><i /><i className="l" />
      <p>Loading players, schedules and news…</p>
    </div>
  )
}

export default function App() {
  const tab = useHash()
  const narrow = useNarrow()
  const pdata = useFetch('/api/players')
  const ndata = useFetch('/api/news')
  const fdata = useFetch('/data/form.json') // worker/ingest.py; absent until it has run
  const ddata = useFetch('/data/dvp.json')
  const bdata = useFetch('/data/backtest.json')
  const [settings, setSettings] = useLocal('cs.settings.v3', DEFAULT_SETTINGS)
  const [mine, setMine] = useLocal('cs.mine', [])
  const [taken, setTaken] = useLocal('cs.taken', [])
  const [rosterLoaded, setRosterLoaded] = useLocal('cs.roster.drafted', false)
  const [espn, setEspn] = useLocal('cs.espn', { league: '', s2: '', swid: '', team: null })
  const [ledger, setLedger] = useLocal('cs.ledger.v1', {})
  const [incoming, setIncoming] = useState(() => tokenInUrl())
  useEffect(() => {
    const f = () => { const t = tokenInUrl(); if (t) setIncoming(t) }
    addEventListener('hashchange', f); return () => removeEventListener('hashchange', f)
  }, [])
  const league = useEspnLeague(espn.league ? espn : null)
  const conn = espn.league && espn.team ? espn : null
  // Live matchup and past weeks live here, not on one page: Today needs the odds too, and the
  // ledger has to keep recording and settling whichever page is open.
  const live = useMatchup(conn)
  const hist = useHistory(conn)
  const [openId, setOpenId] = useState(null)
  const [finding, setFinding] = useState(false)
  useEffect(() => { scrollTo(0, 0) }, [tab])

  useEffect(() => {
    const k = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); setFinding((f) => !f) }
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && /^[1-6]$/.test(e.key)) {
        const t = TABS[+e.key - 1]; if (t) { e.preventDefault(); location.hash = t[0] }
      }
    }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])

  const s = { ...DEFAULT_SETTINGS, ...settings }
  const players = pdata.data?.players || []
  const teams = pdata.data?.teams || {}
  const values = useMemo(() => (players.length ? computeValues(players, s) : new Map()), [players, JSON.stringify(s)])
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])

  // Connected: every roster comes from ESPN, so an add or drop there shows up here on the next load.
  const linked = !!(league.at && espn.team && league.rosters[espn.team])
  useEffect(() => {
    if (!linked || !players.length) return
    const known = (ids) => ids.filter((id) => byId.has(id))
    setMine(known(league.rosters[espn.team]))
    setTaken(known(Object.entries(league.rosters).filter(([id]) => +id !== espn.team).flatMap(([, ids]) => ids)))
  }, [league.at, espn.team, players])

  // Not connected, first visit: load the drafted team. After that the app's own Add and Drop are the record.
  useEffect(() => {
    if (linked || rosterLoaded || !players.length) return
    const idByName = new Map(players.map((p) => [normName(p.name), p.id]))
    const ids = DEFAULT_ROSTER.map((n) => idByName.get(normName(n))).filter(Boolean)
    if (ids.length) setMine(ids)
    setRosterLoaded(true)
  }, [players, rosterLoaded])

  // News and the injury report on each player: RotoWire by name, ESPN by athlete id.
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

  // The wider press, swept across the roster in one call, so an off-court event shows up unasked.
  const sweepUrl = useMemo(() => {
    const names = mine.map((id) => byId.get(id)?.name).filter(Boolean).sort()
    return names.length ? `/api/news?players=${encodeURIComponent(names.join('|'))}` : null
  }, [mine, byId])
  const sdata = useFetch(sweepUrl)
  const offCourtBy = useMemo(() => {
    const by = new Map()
    for (const n of sdata.data?.news || []) {
      const item = { ...n, tags: tagNews(`${n.title} ${n.body || ''}`) }
      if (!item.tags.length) continue
      const key = normName(n.name)
      if (!by.has(key)) by.set(key, [])
      by.get(key).push(item)
    }
    return new Map(players.map((p) => [p.id, by.get(normName(p.name))]).filter(([, v]) => v))
  }, [sdata.data, players])

  const formBy = useMemo(() => {
    const by = new Map()
    for (const r of fdata.data?.players || []) by.set(r.norm ?? normName(r.name), r)
    return new Map(players.map((p) => [p.id, by.get(normName(p.name))]).filter(([, v]) => v))
  }, [fdata.data, players])

  // Finals come from ESPN; settling is idempotent, so it runs on every load.
  useEffect(() => {
    if (hist.weeks?.length) setLedger((l) => settle(l, hist.weeks))
  }, [hist.weeks])
  const sdScale = useMemo(() => spreadScale({ replay: bdata.data?.margin, ledger: score(ledger).margin }), [bdata.data, ledger])

  const mineSet = new Set(mine); const takenSet = new Set(taken)
  const avail = (p) => availability({ inj: p.inj, report: injuryBy.get(p.id), news: newsBy.get(p.id), offCourt: offCourtBy.get(p.id) })
  const status = (p) => avail(p).status
  const setOwner = (id, who) => {
    setMine((m) => (who === 'mine' ? [...new Set([...m, id])] : m.filter((x) => x !== id)))
    setTaken((t) => (who === 'taken' ? [...new Set([...t, id])] : t.filter((x) => x !== id)))
  }
  const moveTo = (id, who) => {
    const prev = mineSet.has(id) ? 'mine' : takenSet.has(id) ? 'taken' : 'free'
    if (prev === who) return
    setOwner(id, who)
    toast(`${byId.get(id)?.name ?? 'Player'} ${OWNER_MSG[who]}`, { action: { label: 'Undo', onClick: () => setOwner(id, prev) } })
  }

  const freeIds = linked && league.freeIds ? new Set(league.freeIds) : null
  const exactTaken = !!freeIds || taken.length >= (s.teams - 1) * s.rosterSize * 0.8
  const isFree = (p) => (freeIds ? freeIds.has(p.id) : !mineSet.has(p.id) && !takenSet.has(p.id) && (exactTaken || p.own < s.ownCutoff))

  const myPlayers = mine.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => (values.get(b.id)?.val ?? -99) - (values.get(a.id)?.val ?? -99))
  // A man on IR is still mine but off the active roster: no page starts him or charges a spot for him.
  const { active: activePlayers, ir: irPlayers } = splitIR(myPlayers, (p) => status(p) === 'out', s.ir ?? 0)

  const ctx = {
    isFree, exactTaken, espn, setEspn, league, linked,
    players, byId, teams, values, formBy, formUpdated: fdata.data?.updated, formCurrent: !!fdata.data?.is_current_season, dvp: ddata.data, backtest: bdata.data, sdScale, settings: s, setSettings, mine, setMine, taken, setTaken, mineSet, takenSet,
    newsBy, injuryBy, offCourtBy, status, avail, ledger, setOwner, moveTo, toast, open: setOpenId, find: () => setFinding(true), newsUpdated: ndata.data?.updated,
    myPlayers, activePlayers, irPlayers, live,
  }

  const today = etToday()
  const [weekStart, weekEnd] = weekBounds(today)
  const slotN = s.slots.split(',').map((x) => x.trim()).filter(Boolean).length
  const odds = useMemo(
    () => weekOdds(ctx, live.data, { today, weekStart, weekEnd, slots: slotN }),
    [live.data, players, formBy, ddata.data, sdScale, values, injuryBy, newsBy, today, slotN],
  )
  ctx.odds = odds

  // Write this week's claim down the first time it is seen and never again: what gets graded
  // is what the model said before it knew. recordWeek ignores a week it already holds.
  useEffect(() => {
    const d = live.data
    if (!odds || !d?.matchupPeriod) return
    setLedger((l) => recordWeek(l, {
      week: d.matchupPeriod, season: SEASON_TAG,
      pWin: odds.pWin, pWinRaw: odds.pWinRaw, sdScale: odds.sdScale,
      myMu: odds.me.mu, mySd: odds.me.sd, myGames: odds.me.games,
      oppMu: odds.opp.mu, oppSd: odds.opp.sd, oppGames: odds.opp.games,
      me: d.me?.name ?? null, opp: d.opp?.name ?? null, daysLeft: odds.daysLeft,
    }))
  }, [odds, live.data?.matchupPeriod])

  const current = TABS.find((t) => t[0] === tab) || TABS[0]
  const Page = current[2]
  const ready = !!pdata.data && players.length > 0

  const nav = (
    <nav className="tabs" aria-label="Pages">
      {TABS.map(([k, label]) => (
        <a key={k} href={`#${k}`} className={`${tab === k ? 'on' : ''}${k === 'league' ? ' setup' : ''}`} aria-current={tab === k ? 'page' : undefined}>{label}</a>
      ))}
    </nav>
  )

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <a className="brand" href="#today" aria-label="Courtside, today"><span className="ball" aria-hidden="true" /><span className="word">Courtside</span></a>
        {!narrow && nav}
        <div className="topright">
          {linked ? <span className="conn"><i className="livedot" aria-hidden="true" />ESPN linked</span> : <a className="conn" href="#league">Connect league</a>}
          <button className="findbtn" onClick={() => setFinding(true)} aria-label="Find a player">
            <SearchIcon /><span className="lbl">Find</span><kbd>{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <a className={`gear${tab === 'league' ? ' on' : ''}`} href="#league" aria-label="Setup" aria-current={tab === 'league' ? 'page' : undefined}><GearIcon /></a>
        </div>
      </header>
      {narrow && nav}

      <main className="main" id="main" tabIndex={-1}>
        {pdata.error && <p className="banner bad">Could not load player data: {pdata.error}. Refresh in a minute.</p>}
        {!pdata.data && !pdata.error ? <Loading /> : ready && <Page ctx={ctx} />}
      </main>

      {incoming && <LinkIn token={incoming}
        onDone={(c) => { setEspn(c); setIncoming(null); clearToken(); toast('Connected. Your league is on this device now.') }}
        onCancel={() => { setIncoming(null); clearToken() }} />}
      {ready && <PlayerFinder ctx={ctx} open={finding} setOpen={setFinding} pages={TABS} />}
      <Toaster theme="dark" position="bottom-center" offset={24} mobileOffset={{ bottom: 'calc(80px + env(safe-area-inset-bottom))' }} toastOptions={{ className: 'toast' }} />
      {openId && byId.get(openId) && <PlayerDrawer ctx={ctx} p={byId.get(openId)} onClose={() => setOpenId(null)} />}
    </div>
  )
}

// A setup link made on another device. The six digits that open it travel separately.
function LinkIn({ token, onDone, onCancel }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { onDone(await unpack(token, code)) } catch {
      setError('That code does not open this link.')
      setBusy(false)
    }
  }
  return (
    <div className="linkin">
      <form onSubmit={submit}>
        <h2>Finish setting up this device</h2>
        <p>Type the six digits shown on the other device.</p>
        <input autoFocus inputMode="numeric" pattern="[0-9]*" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Six digit code" />
        <div className="row">
          <button className="btn" type="submit" disabled={code.length !== 6 || busy}>Connect league</button>
          <button className="btn ghost" type="button" onClick={onCancel}>Not now</button>
        </div>
        {error && <p className="banner bad">{error}</p>}
      </form>
    </div>
  )
}
