import { useEffect, useState } from 'react'

// useState that survives reloads (this app has no accounts; your league lives in this browser).
export function useLocal(key, init) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : init } catch { return init }
  })
  useEffect(() => { localStorage.setItem(key, JSON.stringify(v)) }, [key, v])
  return [v, setV]
}

export function useFetch(url) {
  const [state, setState] = useState({ data: null, error: null })
  useEffect(() => {
    let live = true
    if (!url) return () => { live = false } // nothing to ask for yet, which is not an error
    fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url} returned ${r.status}`))))
      .then((data) => live && setState({ data, error: null }))
      .catch((error) => live && setState({ data: null, error: String(error.message || error) }))
    return () => { live = false }
  }, [url])
  return state
}
