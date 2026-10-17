// Player pool + team schedules from ESPN's public fantasy API, trimmed to what the app uses.
const SEASON = 2027 // ESPN names the 2026-27 season by its end year
const BASE = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${SEASON}`

// ESPN stat ids -> our keys
const STAT = { 0: 'pts', 1: 'blk', 2: 'stl', 3: 'ast', 6: 'reb', 11: 'to', 13: 'fgm', 14: 'fga', 15: 'ftm', 16: 'fta', 17: 'tpm', 40: 'min', 42: 'gp' }
// stat row id -> our split name
const SPLITS = { [`10${SEASON}`]: 'proj', [`00${SEASON - 1}`]: 'last', [`00${SEASON}`]: 'cur', [`01${SEASON}`]: 'l7', [`02${SEASON}`]: 'l15' }
const POS = ['PG', 'SG', 'SF', 'PF', 'C'] // eligible slot ids 0-4

function trimStats(avg) {
  if (!avg || !Object.keys(avg).length) return null
  const out = {}
  for (const [id, key] of Object.entries(STAT)) out[key] = +(avg[id] ?? 0).toFixed(2)
  return out.gp > 0 || out.pts > 0 ? out : null
}

const etDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export default async function handler(req, res) {
  const filter = {
    players: {
      limit: 650,
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'STANDARD' },
      filterStatsForSourceIds: { value: [0, 1] },
      filterStatsForSplitTypeIds: { value: [0, 1, 2] },
      filterStatsForExternalIds: { value: [SEASON - 1, SEASON] },
    },
  }
  try {
    const [pr, sr] = await Promise.all([
      fetch(`${BASE}/segments/0/leaguedefaults/1?view=kona_player_info`, { headers: { 'X-Fantasy-Filter': JSON.stringify(filter) } }),
      fetch(`${BASE}?view=proTeamSchedules_wl`),
    ])
    if (!pr.ok || !sr.ok) throw new Error(`ESPN responded ${pr.status}/${sr.status}`)
    const [pj, sj] = await Promise.all([pr.json(), sr.json()])

    const teams = {}
    for (const t of sj.settings.proTeams) {
      if (!t.id) continue // id 0 = free agent
      const games = Object.values(t.proGamesByScoringPeriod || {}).flat()
        .map((g) => ({ d: etDate(g.date), t: g.date, opp: g.homeProTeamId === t.id ? g.awayProTeamId : g.homeProTeamId, home: g.homeProTeamId === t.id }))
        .sort((a, b) => a.t - b.t)
      teams[t.id] = { abbrev: t.abbrev, name: `${t.location} ${t.name}`, games }
    }

    const players = []
    for (const { player: p } of pj.players) {
      const stats = {}
      for (const s of p.stats || []) if (SPLITS[s.id]) stats[SPLITS[s.id]] = trimStats(s.averageStats)
      if (!stats.proj && !stats.cur && !stats.last) continue
      const o = p.ownership || {}
      players.push({
        id: p.id,
        name: p.fullName,
        team: p.proTeamId,
        pos: POS.filter((_, i) => p.eligibleSlots?.includes(i)),
        inj: p.injuryStatus || 'ACTIVE',
        adp: o.averageDraftPosition ? +o.averageDraftPosition.toFixed(1) : null,
        own: +(o.percentOwned ?? 0).toFixed(1),
        ownChg: +(o.percentChange ?? 0).toFixed(2),
        outlook: p.seasonOutlook || '',
        stats,
      })
    }

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400')
    res.status(200).json({ updated: new Date().toISOString(), players, teams })
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
}
