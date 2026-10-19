import { useEffect, useRef, useState } from 'react'

const EVERY = 5000 // ESPN's board moves one pick at a time; 5s is live enough and gentle on their API
const OFF = { status: 'off', picks: [], teams: [], pickOrder: [], size: 0, error: null, at: null }

// Polls /api/draft for one ESPN league. conn is null until the user connects, which stops the timer.
export function useLiveDraft(conn) {
  const [state, setState] = useState(OFF)
  const seen = useRef('')
  useEffect(() => {
    if (!conn?.league) { setState(OFF); return }
    let live = true
    let timer
    const run = async () => {
      try {
        const r = await fetch('/api/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ league: conn.league, s2: conn.s2 || '', swid: conn.swid || '' }),
        })
        const j = await r.json()
        if (!live) return
        if (!r.ok) throw new Error(j.error || `ESPN lookup failed (${r.status})`)
        setState({ status: j.complete ? 'done' : 'on', picks: j.picks, teams: j.teams, pickOrder: j.pickOrder, size: j.size, error: null, at: Date.now() })
        seen.current = String(j.picks.length)
        if (j.complete) return // nothing left to watch
      } catch (e) {
        // Keep the last good board on screen; a dropped poll is not a reason to blank the page.
        if (live) setState((s) => ({ ...s, status: s.picks.length ? 'stale' : 'error', error: String(e.message || e) }))
      }
      if (live) timer = setTimeout(run, EVERY)
    }
    run()
    return () => { live = false; clearTimeout(timer) }
  }, [conn?.league, conn?.s2, conn?.swid])
  return state
}
