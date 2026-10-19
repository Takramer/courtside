// Live draft board for one ESPN league: who has been picked, in what order, by which team.
// POST only, because a private league needs the two cookie values and those must not sit in a URL.
const SEASON = 2027 // keep in step with api/players.js
const BASE = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${SEASON}/segments/0/leagues`

const teamName = (t) => t.name?.trim() || `${t.location ?? ''} ${t.nickname ?? ''}`.trim() || t.abbrev || `Team ${t.id}`

async function readBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST a league id to this endpoint' })
  let body
  try { body = await readBody(req) } catch { return res.status(400).json({ error: 'Could not read the request' }) }

  const league = String(body.league ?? '').replace(/\D/g, '')
  if (!league) return res.status(400).json({ error: 'League id missing. It is the leagueId number in your ESPN league URL.' })

  // Cookies only travel server-side, and only when the league is private.
  const headers = {}
  if (body.s2 && body.swid) {
    const swid = String(body.swid).trim().replace(/^\{?/, '{').replace(/\}?$/, '}')
    headers.Cookie = `espn_s2=${String(body.s2).trim()}; SWID=${swid}`
  }

  try {
    const r = await fetch(`${BASE}/${league}?view=mDraftDetail&view=mTeam&view=mSettings`, { headers })
    if (r.status === 401) throw new Error('ESPN says this league is private. Paste your espn_s2 and SWID cookies to read it.')
    // ESPN answers 404 both for a league that does not exist and for a private one it will not show a stranger.
    if (r.status === 404) throw new Error(`ESPN will not show league ${league} for the ${SEASON - 1}-${String(SEASON).slice(2)} season. Check the id, and tick Private league if it is not public.`)
    if (!r.ok) throw new Error(`ESPN responded ${r.status}`)
    const j = await r.json()

    const d = j.draftDetail || {}
    const picks = (d.picks || [])
      .filter((p) => p.playerId > 0)
      .map((p) => ({ overall: p.overallPickNumber, round: p.roundId, roundPick: p.roundPickNumber, teamId: p.teamId, playerId: p.playerId, keeper: !!p.keeper }))
      .sort((a, b) => a.overall - b.overall)

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      at: new Date().toISOString(),
      complete: !!d.drafted,
      inProgress: !!d.inProgress,
      size: j.settings?.size ?? (j.teams || []).length,
      pickOrder: j.settings?.draftSettings?.pickOrder ?? [],
      teams: (j.teams || []).map((t) => ({ id: t.id, name: teamName(t), abbrev: t.abbrev || '' })),
      picks,
    })
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
}
