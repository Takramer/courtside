// Your own ESPN league: who sits on which roster, and who ESPN itself counts as free.
// Endpoints and filters follow cwendt94/espn-api (espn_api/basketball/league.py, espn_api/requests/espn_requests.py).
// POST only: a private league needs the two cookie values and those must not travel in a URL.
const SEASON = 2027 // ESPN names the 2026-27 season by its end year; keep in step with api/players.js
const BASE = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${SEASON}/segments/0/leagues`

const teamName = (t) => t.name?.trim() || `${t.location ?? ''} ${t.nickname ?? ''}`.trim() || t.abbrev || `Team ${t.id}`

async function readBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

function espnError(status, league) {
  if (status === 401) return 'ESPN turned the request down. Your espn_s2 and SWID cookies are missing or have expired: copy them again.'
  if (status === 404) return `ESPN will not show league ${league} for the ${SEASON - 1}-${String(SEASON).slice(2)} season. Check the id, and check the cookies if the league is private.`
  return `ESPN responded ${status}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST a league id to this endpoint' })
  let body
  try { body = await readBody(req) } catch { return res.status(400).json({ error: 'Could not read the request' }) }

  const league = String(body.league ?? '').replace(/\D/g, '')
  if (!league) return res.status(400).json({ error: 'League id missing. It is the leagueId number in your ESPN league URL.' })

  const headers = {}
  if (body.s2 && body.swid) {
    const swid = String(body.swid).trim().replace(/^\{?/, '{').replace(/\}?$/, '}')
    headers.Cookie = `espn_s2=${String(body.s2).trim()}; SWID=${swid}`
  }

  try {
    // One call for teams, rosters and settings, the way the library's get_league does it.
    const r = await fetch(`${BASE}/${league}?view=mTeam&view=mRoster&view=mSettings`, { headers })
    if (!r.ok) throw new Error(espnError(r.status, league))
    const j = await r.json()

    const rosters = {}
    for (const t of j.teams || []) {
      rosters[t.id] = (t.roster?.entries || []).map((e) => e.playerId ?? e.playerPoolEntry?.player?.id).filter(Boolean)
    }

    // ESPN's own answer to "who is free in THIS league", rather than a guess from league-wide ownership.
    const scoringPeriod = j.scoringPeriodId ?? 1
    const filter = {
      players: {
        filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
        limit: 400,
        sortPercOwned: { sortPriority: 1, sortAsc: false },
      },
    }
    const fr = await fetch(`${BASE}/${league}?view=kona_player_info&scoringPeriodId=${scoringPeriod}`,
      { headers: { ...headers, 'X-Fantasy-Filter': JSON.stringify(filter) } })
    if (!fr.ok) throw new Error(espnError(fr.status, league))
    const fj = await fr.json()

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      at: new Date().toISOString(),
      scoringPeriod,
      name: j.settings?.name || '',
      size: j.settings?.size ?? (j.teams || []).length,
      teams: (j.teams || []).map((t) => ({ id: t.id, name: teamName(t), abbrev: t.abbrev || '' })),
      rosters,
      freeIds: (fj.players || []).map((p) => p.id ?? p.player?.id).filter(Boolean),
    })
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
}
