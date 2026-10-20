import { useCallback, useEffect, useState } from 'react'

const IDLE = { at: null, teams: [], rosters: {}, freeIds: null, name: '', loading: false, error: null }

// Reads one ESPN league through /api/league. Once per load, plus whenever you call reload().
export function useEspnLeague(conn) {
  const [state, setState] = useState(IDLE)
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!conn?.league) { setState(IDLE); return }
    let live = true
    setState((s) => ({ ...s, loading: true }))
    fetch('/api/league', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ league: conn.league, s2: conn.s2 || '', swid: conn.swid || '' }),
    })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || `ESPN lookup failed (${r.status})`)
        return j
      })
      .then((j) => live && setState({ at: Date.now(), teams: j.teams, rosters: j.rosters, freeIds: j.freeIds, name: j.name, loading: false, error: null }))
      // Keep the last good read on screen: a dropped call is not a reason to forget the league.
      .catch((e) => live && setState((s) => ({ ...s, loading: false, error: String(e.message || e) })))
    return () => { live = false }
  }, [conn?.league, conn?.s2, conn?.swid, nonce])

  return { ...state, reload }
}

// This week's head-to-head, refreshed while you watch. ESPN moves a player's points within a minute of the box score.
export function useMatchup(conn, every = 60000) {
  const [state, setState] = useState({ at: null, data: null, loading: false, error: null })
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!conn?.league || !conn?.team) { setState({ at: null, data: null, loading: false, error: null }); return }
    let live = true
    let timer
    const run = async () => {
      setState((s) => ({ ...s, loading: true }))
      try {
        const r = await fetch('/api/matchup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ league: conn.league, s2: conn.s2 || '', swid: conn.swid || '', team: conn.team }),
        })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || `ESPN lookup failed (${r.status})`)
        if (live) setState({ at: Date.now(), data: j, loading: false, error: null })
      } catch (e) {
        // Last good score stays on screen; a dropped poll is not a score of zero.
        if (live) setState((s) => ({ ...s, loading: false, error: String(e.message || e) }))
      }
      if (live) timer = setTimeout(run, every)
    }
    run()
    // Coming back to the tab should show the score now, not up to a minute later.
    const onVis = () => { if (document.visibilityState === 'visible' && live) { clearTimeout(timer); run() } }
    document.addEventListener('visibilitychange', onVis)
    return () => { live = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [conn?.league, conn?.team, conn?.s2, conn?.swid, nonce, every])

  return { ...state, reload }
}

// Every week that is already over, straight from ESPN. Phase 8 grades against these rather
// than against whatever score the app happened to see last — which, for anyone who did not
// open it on Sunday night, would be Sunday afternoon's.
export function useHistory(conn) {
  const [state, setState] = useState({ at: null, weeks: null, loading: false, error: null })

  useEffect(() => {
    if (!conn?.league || !conn?.team) { setState({ at: null, weeks: null, loading: false, error: null }); return }
    let live = true
    setState((s) => ({ ...s, loading: true }))
    fetch('/api/matchup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ league: conn.league, s2: conn.s2 || '', swid: conn.swid || '', team: conn.team, history: true }),
    })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || `ESPN lookup failed (${r.status})`)
        return j
      })
      .then((j) => live && setState({ at: Date.now(), weeks: j.weeks, loading: false, error: null }))
      .catch((e) => live && setState((s) => ({ ...s, loading: false, error: String(e.message || e) })))
    return () => { live = false }
  }, [conn?.league, conn?.team, conn?.s2, conn?.swid])

  return state
}
