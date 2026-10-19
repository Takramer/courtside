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
