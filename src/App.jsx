import React, { useEffect, useMemo, useState } from 'react'
import { useFetch, useLocal } from './lib/store.js'
import { useEspnLeague } from './lib/espn.js'
import { clearToken, tokenInUrl, unpack } from './lib/link.js'
import { bestLineup, computeValues, DEFAULT_ROSTER, DEFAULT_SETTINGS, etToday, gamesBetween, normName, tagNews, weekBounds } from './lib/model.js'
import { availability } from './lib/predict.js'
import { score, spreadScale } from './lib/grade.js'
import { Toaster, toast } from 'sonner'
import { PlayerDrawer, PlayerFinder } from './components.jsx'
import Team from './pages/Team.jsx'
import Matchup from './pages/Matchup.jsx'
import Waivers from './pages/Waivers.jsx'
import Trade from './pages/Trade.jsx'
import News from './pages/News.jsx'
import League from './pages/League.jsx'
import Scorecard from './pages/Scorecard.jsx'

// key, full name, page, rail label. The rail label is the page's own name shortened, never
// a new word for it: the rail is wide enough for 'Scorecard', so it says Scorecard.
const TABS = [
  ['team', 'My team', Team, 'Team'],
  ['week', 'This week', Matchup, 'Week'],
  ['waivers', 'Waivers', Waivers, 'Waivers'],
  ['trade', 'Trade', Trade, 'Trade'],
  ['news', 'News', News, 'News'],
  ['scorecard', 'Scorecard', Scorecard, 'Scorecard'],
  ['league', 'League setup', League, 'Setup'],
]
const DATE_FMT = { weekday: 'short', day: 'numeric', month: 'short' }

const OWNER_MSG = { mine: 'added to your team', taken: 'marked taken by another team', free: 'marked available' }
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function Loading() {
  return (
    <div className="skel" aria-busy="true">
      <i className="h" /><i className="l" />
      <div className="row3"><i className="c" /><i className="c" /><i className="c" /></div>
      <i /><i /><i className="l" /><i /><i className="l" /><i /><i className="l" />
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
  const fdata = useFetch('/data/form.json') // written by worker/ingest.py; absent until it has run
  const ddata = useFetch('/data/dvp.json')  // same worker: what each team gives up by position
  const mdata = useFetch('/data/matchups.json') // defender vs scorer, possession by possession
  const xdata = useFetch('/data/friction.json') // flagrants and double technicals, both men named
  const bdata = useFetch('/data/backtest.json') // npm run backtest: last season replayed through the engine
  // v3: the real ESPN slots (PF/C, two UT) replace the old three-UT guess; a new key drops the settings saved under it
  const [settings, setSettings] = useLocal('cs.settings.v3', DEFAULT_SETTINGS)
  const [mine, setMine] = useLocal('cs.mine', [])
  const [taken, setTaken] = useLocal('cs.taken', [])
  const [rosterLoaded, setRosterLoaded] = useLocal('cs.roster.drafted', false)
  const [espn, setEspn] = useLocal('cs.espn', { league: '', s2: '', swid: '', team: null })
  // Phase 8: what the model claimed each week, written once, before the games.
  const [ledger, setLedger] = useLocal('cs.ledger.v1', {})
  const [incoming, setIncoming] = useState(() => tokenInUrl())
  // Opening the link in a tab that already has the app running only changes the hash, so
  // watch for that too rather than silently doing nothing.
  useEffect(() => {
    const f = () => { const t = tokenInUrl(); if (t) setIncoming(t) }
    addEventListener('hashchange', f); return () => removeEventListener('hashchange', f)
  }, [])
  const league = useEspnLeague(espn.league ? espn : null)
  const [openId, setOpenId] = useState(null)
  const [finding, setFinding] = useState(false)

  // ⌘K / Ctrl+K anywhere, or "/" when not typing, opens the player finder.
  useEffect(() => {
    const k = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); setFinding((f) => !f) }
      // 1-7 jump between pages. The rail prints the number beside each one, so the keys are
      // discoverable rather than folklore.
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && /^[1-7]$/.test(e.key)) {
        const t = TABS[+e.key - 1]; if (t) { e.preventDefault(); location.hash = t[0] }
      }
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

  // Phase 7: the wider press, swept across the roster in one call so an off-court event
  // reaches the app without you having to suspect someone first. Roster-sized, cached
  // server-side for fifteen minutes, and the URL is stable so it fetches once per roster
  // rather than on every render.
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

  // Game-to-game spread per player, joined on the same normalised name the news uses.
  const formBy = useMemo(() => {
    const by = new Map()
    for (const r of fdata.data?.players || []) by.set(r.norm ?? normName(r.name), r)
    return new Map(players.map((p) => [p.id, by.get(normName(p.name))]).filter(([, v]) => v))
  }, [fdata.data, players])

  // How far to widen the live odds: last season's replay as the prior, your own graded weeks
  // as the evidence, the second taking over as the season fills in.
  const sdScale = useMemo(() => spreadScale({ replay: bdata.data?.margin, ledger: score(ledger).margin }), [bdata.data, ledger])

  const mineSet = new Set(mine); const takenSet = new Set(taken)
  // One resolver for the whole app (phase 7). It was two, and they had drifted: the matchup
  // page read the fantasy flag while everything else read the injury report, so a player
  // could be out on one screen and fine on the next.
  const avail = (p) => availability({
    inj: p.inj, report: injuryBy.get(p.id), news: newsBy.get(p.id), offCourt: offCourtBy.get(p.id),
  })
  const status = (p) => avail(p).status
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
    players, byId, teams, values, formBy, formUpdated: fdata.data?.updated, formCurrent: !!fdata.data?.is_current_season, dvp: ddata.data, dvpUpdated: ddata.data?.updated, matchups: mdata.data, friction: xdata.data, backtest: bdata.data, sdScale, settings: s, setSettings, mine, setMine, taken, setTaken, mineSet, takenSet,
    newsBy, injuryBy, offCourtBy, status, avail, ledger, setLedger, setOwner, moveTo, toast, open: setOpenId, find: () => setFinding(true), newsUpdated: ndata.data?.updated,
    myPlayers: mine.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => (values.get(b.id)?.val ?? -99) - (values.get(a.id)?.val ?? -99)),
  }
  const Page = (TABS.find((t) => t[0] === tab) || TABS[0])[2]

  // The readout bar carries the facts every page agrees on, in the same place on every page.
  // The week's win probability is deliberately not one of them: only This week can compute
  // it, and a stale copy sitting up here would be worse than no copy at all.
  const [, weekEnd] = weekBounds(etToday())
  const wkGames = ctx.myPlayers.reduce((n, p) => n + gamesBetween(teams[p.team], etToday(), weekEnd).length, 0)
  const outN = ctx.myPlayers.filter((p) => status(p) === 'out').length
  const gtdN = ctx.myPlayers.filter((p) => status(p) === 'dtd').length
  const openSlots = s.rosterSize - mine.length
  const ready = !!pdata.data && players.length > 0
  // How many starting slots are filled by someone who will actually play. This is the one
  // reading that tells you whether tonight is already losing, and it is cheap enough to
  // recompute on every render for thirteen players.
  const startSlots = s.slots.split(',').map((x) => x.trim()).filter(Boolean)
  const starters = bestLineup(ctx.myPlayers, startSlots).starters
  const okStarters = starters.filter((r) => r.player && status(r.player) === 'ok').length
  const lineupBad = okStarters < startSlots.length

  return (
    <div className="app">
      <div className="rail">
        <a className="brand" href="#team" aria-label="Courtside — my team"><span className="ball" /></a>
        <nav aria-label="Pages">
          {TABS.map(([k, label, , short], i) => (
            <a key={k} href={`#${k}`} className={tab === k ? 'on' : ''} title={`${label} (${i + 1})`}>
              <span className="k">{i + 1}</span>{short}
            </a>
          ))}
        </nav>
        <button className="railfind" onClick={() => setFinding(true)} aria-label="Find a player">
          <span className="k">{IS_MAC ? '\u2318K' : '^K'}</span>Find
        </button>
      </div>

      <div className="body">
        <header className="readout">
          <div className="cell lo"><span className="lbl">Date</span><b>{new Date().toLocaleDateString(undefined, DATE_FMT)}</b></div>
          <div className="cell"><span className="lbl">Roster</span>
            <b style={openSlots > 0 ? { color: 'var(--warn)' } : undefined}>{mine.length}/{s.rosterSize}</b>
            {openSlots > 0 && <span className="sub">{openSlots} open</span>}
          </div>
          <div className="cell"><span className="lbl">Lineup</span>
            <b style={lineupBad ? { color: 'var(--bad)' } : undefined}>{okStarters}/{startSlots.length}</b>
            <span className="sub">{lineupBad ? 'will play' : 'all set'}</span>
          </div>
          <div className="cell"><span className="lbl">Wk games</span><b>{ready ? wkGames : '–'}</b></div>
          <div className="cell"><span className="lbl">Out</span>
            <b style={outN > 0 ? { color: 'var(--bad)' } : { color: 'var(--muted)' }}>{outN}</b>
          </div>
          <div className="cell"><span className="lbl">GTD</span>
            <b style={gtdN > 0 ? { color: 'var(--warn)' } : { color: 'var(--muted)' }}>{gtdN}</b>
          </div>
          <div className="cell right">
            <span className={`livedot ${linked ? '' : 'off'}`} />
            {linked ? 'ESPN linked' : <a href="#league">not linked</a>}
            <span className="mono">{pdata.data ? new Date(pdata.data.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
          </div>
        </header>

        <main className="pane">
          {pdata.error && <div className="pad"><div className="banner bad">Could not load player data: {pdata.error}. Refresh in a minute.</div></div>}
          {!pdata.data && !pdata.error ? <Loading /> : ready && <Page ctx={ctx} />}
        </main>
      </div>

      <div className="statusbar">
        <span>ESPN proj {fdata.data ? '+ stats.nba.com logs' : '\u00b7 no local logs yet'}</span>
        {fdata.data?.updated && <span>form {new Date(fdata.data.updated).toLocaleDateString()}</span>}
        <span>{ddata.data ? `dvp ${ddata.data.season}` : 'no dvp table'}</span>
        {bdata.data?.brier != null && <span>brier {bdata.data.brier.toFixed(3)}</span>}
        <span className="right">
          <span><kbd>1</kbd>&ndash;<kbd>7</kbd> pages</span>
          <span><kbd>{IS_MAC ? '\u2318K' : '^K'}</kbd> find</span>
        </span>
      </div>

      {incoming && <LinkIn token={incoming}
        onDone={(conn) => { setEspn(conn); setIncoming(null); clearToken(); toast('Connected. Your league is on this device now.') }}
        onCancel={() => { setIncoming(null); clearToken() }} />}
      {ready && <PlayerFinder ctx={ctx} open={finding} setOpen={setFinding} pages={TABS} />}
      <Toaster theme="dark" position="bottom-center" offset={36} toastOptions={{ className: 'toast' }} />
      {openId && byId.get(openId) && <PlayerDrawer ctx={ctx} p={byId.get(openId)} onClose={() => setOpenId(null)} />}
    </div>
  )
}

// Someone opened a setup link made on another device. The link alone is useless: the six
// digits that open it travelled separately, and a wrong code fails the tag check below.
function LinkIn({ token, onDone, onCancel }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      onDone(await unpack(token, code))
    } catch {
      setError('That code does not open this link. Check the six digits on the other device.')
      setBusy(false)
    }
  }

  return (
    <div className="linkin">
      <form onSubmit={submit}>
        <h2>Finish setting up this device</h2>
        <p>Type the six digits shown on the device that made this link.</p>
        <input autoFocus inputMode="numeric" pattern="[0-9]*" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Six digit code" />
        <div className="row">
          <button className="btn" type="submit" disabled={code.length !== 6 || busy}>Connect</button>
          <button className="btn ghost" type="button" onClick={onCancel}>Not now</button>
        </div>
        {error && <p className="banner bad">{error}</p>}
      </form>
    </div>
  )
}
