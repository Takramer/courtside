// This week's head-to-head: both scores, and every player's points for the day as the games run.
// Views and the schedule filter follow cwendt94/espn-api (espn_api/basketball/league.py box_scores,
// espn_api/basketball/box_score.py H2HPointsBoxScore, box_player.py).
const SEASON = 2027 // keep in step with api/players.js
const BASE = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${SEASON}/segments/0/leagues`
const SLOT = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 7: 'SG/SF', 8: 'G/F', 9: 'PF/C', 10: 'F/C', 11: 'UT', 12: 'BE', 13: 'IR' }

const teamName = (t) => t.name?.trim() || `${t.location ?? ''} ${t.nickname ?? ''}`.trim() || t.abbrev || `Team ${t.id}`

async function readBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

function espnError(status, league) {
  if (status === 401) return 'ESPN turned the request down. Your espn_s2 and SWID cookies are missing or have expired: copy them again.'
  if (status === 404) return `ESPN will not show league ${league} for the ${SEASON - 1}-${String(SEASON).slice(2)} season.`
  return `ESPN responded ${status}`
}

// One entry on a daily roster. ESPN sends several stat rows; take the one for this day, actual over projected.
function lineOf(entry, period) {
  const p = entry.playerPoolEntry?.player || entry.player || {}
  const rows = p.stats || []
  const pick = (src) => rows.find((r) => r.scoringPeriodId === period && r.statSourceId === src)
  const actual = pick(0)
  const projected = pick(1)
  return {
    id: p.id,
    name: p.fullName || 'Player',
    slot: SLOT[entry.lineupSlotId] ?? '',
    starting: entry.lineupSlotId != null && entry.lineupSlotId < 12,
    team: p.proTeamId ?? 0,
    inj: p.injuryStatus || 'ACTIVE',
    points: actual ? +(actual.appliedTotal ?? 0).toFixed(1) : null,
    projected: projected ? +(projected.appliedTotal ?? 0).toFixed(1) : null,
  }
}

function sideOf(side, period, names) {
  if (!side) return null
  const daily = side.rosterForCurrentScoringPeriod || side.rosterForMatchupPeriod || {}
  const week = side.totalPointsLive ?? side.totalPoints ?? side.rosterForMatchupPeriod?.appliedStatTotal ?? 0
  return {
    teamId: side.teamId,
    name: names.get(side.teamId) || `Team ${side.teamId}`,
    week: +(+week).toFixed(1),
    weekProjected: side.totalProjectedPointsLive != null ? +side.totalProjectedPointsLive.toFixed(1) : null,
    today: +(+(daily.appliedStatTotal ?? 0)).toFixed(1),
    players: (daily.entries || []).map((e) => lineOf(e, period)),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST a league id to this endpoint' })
  let body
  try { body = await readBody(req) } catch { return res.status(400).json({ error: 'Could not read the request' }) }

  const league = String(body.league ?? '').replace(/\D/g, '')
  const team = Number(body.team)
  if (!league) return res.status(400).json({ error: 'League id missing.' })
  if (!team) return res.status(400).json({ error: 'Pick your team on League setup first.' })

  const headers = {}
  if (body.s2 && body.swid) {
    const swid = String(body.swid).trim().replace(/^\{?/, '{').replace(/\}?$/, '}')
    headers.Cookie = `espn_s2=${String(body.s2).trim()}; SWID=${swid}`
  }

  try {
    // Which week and which day ESPN thinks it is, plus the team names.
    const sr = await fetch(`${BASE}/${league}?view=mTeam&view=mSettings`, { headers })
    if (!sr.ok) throw new Error(espnError(sr.status, league))
    const sj = await sr.json()
    const period = sj.scoringPeriodId ?? 1
    const matchupPeriod = sj.status?.currentMatchupPeriod ?? 1
    const names = new Map((sj.teams || []).map((t) => [t.id, teamName(t)]))

    const filter = { schedule: { filterMatchupPeriodIds: { value: [matchupPeriod] } } }
    const mr = await fetch(`${BASE}/${league}?view=mMatchupScore&view=mScoreboard&scoringPeriodId=${period}`,
      { headers: { ...headers, 'X-Fantasy-Filter': JSON.stringify(filter) } })
    if (!mr.ok) throw new Error(espnError(mr.status, league))
    const mj = await mr.json()

    const game = (mj.schedule || []).find((m) => m.home?.teamId === team || m.away?.teamId === team)
    const mine = game && game.home?.teamId === team ? 'home' : 'away'

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      at: new Date().toISOString(),
      scoringPeriod: period,
      matchupPeriod,
      winner: game?.winner ?? 'UNDECIDED',
      me: game ? sideOf(game[mine], period, names) : null,
      opp: game ? sideOf(game[mine === 'home' ? 'away' : 'home'], period, names) : null,
    })
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
}
