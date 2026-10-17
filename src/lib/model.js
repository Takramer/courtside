// Pure fantasy math: projections, player values, lineups, draft and trade helpers.
// No React here, so model.check.js can run it under plain node.

export const CATS = [
  { k: 'pts', label: 'PTS', name: 'Points' },
  { k: 'reb', label: 'REB', name: 'Rebounds' },
  { k: 'ast', label: 'AST', name: 'Assists' },
  { k: 'stl', label: 'STL', name: 'Steals' },
  { k: 'blk', label: 'BLK', name: 'Blocks' },
  { k: 'tpm', label: '3PM', name: 'Three-pointers made' },
  { k: 'fgp', label: 'FG%', name: 'Field goal %' },
  { k: 'ftp', label: 'FT%', name: 'Free throw %' },
  { k: 'to', label: 'TO', name: 'Turnovers (fewer is better)' },
]

// ESPN's default points-league scoring
export const DEFAULT_WEIGHTS = { pts: 1, tpm: 1, fgm: 2, fga: -1, ftm: 1, fta: -1, reb: 1, ast: 2, stl: 4, blk: 4, to: -2 }

// Grace One Charlotte FBL (ESPN league 2028559007): 10-team H2H points
export const DEFAULT_SETTINGS = {
  format: 'points', // 'cats' (head-to-head categories) or 'points'
  teams: 10,
  rosterSize: 13,
  slots: 'PG,SG,SF,PF,C,G,F,UT,UT,UT',
  draftSlot: 1,
  punt: [], // category keys to ignore
  weights: { ...DEFAULT_WEIGHTS, ftm: 2 }, // league scores +1 per made FT, -1 per miss; same as FTM 2, FTA -1
  ownCutoff: 60, // hide players rostered in more than this % of ESPN leagues from waivers
}

const KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta', 'min']

// Per-game line used for every decision. Preseason projection early, real stats take over as games pile up.
export function blendLine(stats) {
  const base = stats.proj || stats.last || stats.cur
  const cur = stats.cur
  const gpProj = stats.proj?.gp || stats.last?.gp || 60
  if (!cur?.gp) return { ...base, gp: gpProj, curWeight: 0 }
  const w = cur.gp / (cur.gp + 12) // 12 games in, the season so far counts half
  const line = {}
  for (const k of KEYS) line[k] = (base[k] ?? 0) * (1 - w) + (cur[k] ?? 0) * w
  return { ...line, gp: gpProj, curWeight: w }
}

export const fantasyPoints = (line, w = DEFAULT_WEIGHTS) =>
  line ? Object.entries(w).reduce((s, [k, v]) => s + (line[k] ?? 0) * v, 0) : 0

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1)
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) || 1 }

// Raw category inputs. Percentages become "impact": makes above league rate times volume.
function catRaw(line, lg) {
  return {
    pts: line.pts, reb: line.reb, ast: line.ast, stl: line.stl, blk: line.blk, tpm: line.tpm, to: line.to,
    fgp: line.fgm - line.fga * lg.fg,
    ftp: line.ftm - line.fta * lg.ft,
  }
}

// z-scores per category against the pool of players worth rostering
function zScorer(lines, lg) {
  const raws = lines.map((l) => catRaw(l, lg))
  const stats = {}
  for (const { k } of CATS) { const xs = raws.map((r) => r[k]); stats[k] = { m: mean(xs), s: sd(xs) } }
  return (line) => {
    const r = catRaw(line, lg); const z = {}
    for (const { k } of CATS) z[k] = ((r[k] - stats[k].m) / stats[k].s) * (k === 'to' ? -1 : 1)
    return z
  }
}

const statLine = (s) => (s && s.gp ? s : null)

// Main valuation. Returns Map(id -> info). `val` = per-game value above a waiver-wire player (0 = replaceable).
export function computeValues(players, settings = DEFAULT_SETTINGS) {
  const n = settings.teams * settings.rosterSize
  const rows = players.map((p) => {
    const line = blendLine(p.stats)
    return { p, line, fp: fantasyPoints(line, settings.weights) }
  }).filter((r) => r.line && r.line.min > 0)

  rows.sort((a, b) => b.fp - a.fp)
  const pool = rows.slice(0, n).map((r) => r.line)
  const lg = {
    fg: pool.reduce((s, l) => s + l.fgm, 0) / pool.reduce((s, l) => s + l.fga, 0),
    ft: pool.reduce((s, l) => s + l.ftm, 0) / pool.reduce((s, l) => s + l.fta, 0),
  }
  const z = zScorer(pool, lg)
  const counted = CATS.filter((c) => !settings.punt.includes(c.k)).map((c) => c.k)
  const score = (line) => {
    if (settings.format === 'points') return fantasyPoints(line, settings.weights)
    const zz = z(line); return counted.reduce((s, k) => s + zz[k], 0)
  }

  for (const r of rows) {
    r.z = z(r.line)
    r.raw = score(r.line)
    const l15 = statLine(r.p.stats.l15)
    r.recent = l15 && l15.gp >= 3 ? score(l15) : null
  }
  const byRaw = [...rows].sort((a, b) => b.raw - a.raw)
  const repl = byRaw[Math.min(n, byRaw.length - 1)].raw
  const out = new Map()
  byRaw.forEach((r, i) => {
    const avail = Math.min(1, Math.max(0.3, r.line.gp / 75))
    out.set(r.p.id, {
      line: r.line, fp: r.fp, z: r.z, rank: i + 1,
      val: r.raw - repl,
      seasonVal: (r.raw - repl) * avail,
      trend: r.recent == null ? 0 : r.recent - r.raw, // + = playing above his projection lately
      lg,
    })
  })
  const bySeason = [...out.entries()].sort((a, b) => b[1].seasonVal - a[1].seasonVal)
  bySeason.forEach(([, v], i) => { v.draftRank = i + 1 })
  return out
}

// ---------- schedule ----------

export const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export function weekBounds(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - dow)
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
  return [mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)]
}

export const gamesBetween = (team, from, to) => (team?.games || []).filter((g) => g.d >= from && g.d <= to)
export const gameOn = (team, date) => (team?.games || []).find((g) => g.d === date)

// ---------- lineup ----------

const SLOT_FITS = { PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'], G: ['PG', 'SG'], F: ['SF', 'PF'], UT: null }
export const fitsSlot = (pos, slot) => (SLOT_FITS[slot] === null ? true : pos.some((x) => SLOT_FITS[slot]?.includes(x)))

// Best value first; each new player may bump earlier ones into other open slots they fit (augmenting paths),
// so position quirks never bench a better player when a valid arrangement exists.
export function bestLineup(candidates, slots) {
  const owner = slots.map(() => null)
  const tryPlace = (i, seen) => {
    for (let s = 0; s < slots.length; s++) {
      if (seen.has(s) || !fitsSlot(candidates[i].pos, slots[s])) continue
      seen.add(s)
      if (owner[s] === null || tryPlace(owner[s], seen)) { owner[s] = i; return true }
    }
    return false
  }
  const benched = []
  candidates.forEach((_, i) => { if (!tryPlace(i, new Set())) benched.push(candidates[i]) })
  return { starters: slots.map((slot, s) => ({ slot, player: owner[s] === null ? null : candidates[owner[s]] })), benched }
}

// ---------- draft ----------

export function snakePicks(teams, slot, rounds) {
  const picks = []
  for (let r = 0; r < rounds; r++) picks.push(r * teams + (r % 2 === 0 ? slot : teams + 1 - slot))
  return picks
}

// Other teams mostly draft off ESPN's own rankings, so ADP order is the best guess at who goes before my turn.
export const likelyGone = (available, n) =>
  [...available].sort((a, b) => (a.adp || 999) - (b.adp || 999)).slice(0, Math.max(0, n))

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']
const unitOf = (settings) => (settings.format === 'points' ? 3 : 0.75) // roughly "a clear difference" in each scale
const valUnit = (settings, x) => (settings.format === 'points' ? `${x.toFixed(1)} fantasy points a game` : `${x.toFixed(1)} value`)

// Best value still on the board at each position, ignoring players in `skip`.
function bestByPos(available, values, skip) {
  const best = {}
  for (const p of available) {
    if (skip.has(p.id)) continue
    for (const x of p.pos) best[x] = Math.max(best[x] ?? 0, values.get(p.id)?.seasonVal ?? 0)
  }
  return best
}

// Per position: best I can get at this pick vs. best likely left at my following pick.
// A big drop means the position is drying up and waiting costs real points.
export function positionOutlook({ available, mine, values, settings, gone, goneLater }) {
  const now = bestByPos(available, values, new Set(gone.map((p) => p.id)))
  const later = bestByPos(available, values, new Set(goneLater.map((p) => p.id)))
  const unit = unitOf(settings)
  return POSITIONS.map((pos) => {
    const have = mine.filter((p) => p.pos.includes(pos)).length
    const drop = (now[pos] ?? 0) - (later[pos] ?? 0)
    const level = have >= 2 ? 'covered' : drop >= unit ? 'now' : drop >= unit / 2 ? 'soon' : 'wait'
    const why = {
      covered: `You have ${have}. Only take another if he is clearly the best player left.`,
      now: `The best ${pos} likely left at your following pick is ${valUnit(settings, drop)} worse. Take one this turn.`,
      soon: `Drops by ${valUnit(settings, drop)} by your following pick. Fine to wait one turn, not two.`,
      wait: have ? 'Plenty of similar players will still be there.' : 'You need one, but similar players will still be there. No rush.',
    }[level]
    return { pos, have, drop, level, why }
  })
}

// Rank players for my next pick: value, plus help in my weakest categories, plus what I lose by waiting
// (value over the best player at his position likely left at my following pick).
// `gone`: players expected to go before my next pick; they are left out unless I am on the clock.
export function draftSuggestions({ available, mine, values, settings, nextPick, followingPick, gone = [], goneLater = [] }) {
  const counted = CATS.filter((c) => !settings.punt.includes(c.k)).map((c) => c.k)
  const team = {}
  for (const k of counted) team[k] = mine.reduce((s, p) => s + (values.get(p.id)?.z[k] ?? 0), 0)
  const weak = mine.length >= 2 ? [...counted].sort((a, b) => team[a] - team[b]).slice(0, 3) : []
  const posCount = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 }
  for (const p of mine) for (const x of p.pos) posCount[x]++
  const thinPos = mine.length >= 4 ? Object.keys(posCount).filter((k) => posCount[k] === 0) : []
  const goneSet = new Set(gone.map((p) => p.id))
  const bestLater = bestByPos(available, values, new Set(goneLater.map((p) => p.id)))
  const unit = unitOf(settings)

  return available.filter((p) => !goneSet.has(p.id)).map((p) => {
    const v = values.get(p.id)
    if (!v) return null
    const reasons = []
    let score = v.seasonVal
    if (settings.format === 'cats' && weak.length) {
      const help = weak.reduce((s, k) => s + Math.max(0, v.z[k]), 0)
      score += 0.15 * help
      const helps = weak.filter((k) => v.z[k] > 0.5).map((k) => CATS.find((c) => c.k === k).label)
      if (helps.length) reasons.push(`Helps your weak spots: ${helps.join(', ')}`)
    }
    const fills = p.pos.filter((x) => thinPos.includes(x))
    if (fills.length) { score += 0.2 * (settings.format === 'points' ? 3 : 1); reasons.push(`You have no ${fills.join('/')} yet`) }
    if (goneLater.length) {
      const gap = v.seasonVal - Math.max(0, ...p.pos.map((x) => bestLater[x] ?? 0))
      if (gap > 0) score += 0.5 * gap // half weight: the ADP forecast is a guess
      if (gap >= unit) reasons.push(`Waiting costs you: the best ${p.pos.join('/')} likely left next turn is ${valUnit(settings, gap)} worse`)
    }
    if (p.adp && followingPick && p.adp < followingPick) reasons.push(`Usually gone before your following pick (#${followingPick})`)
    if (p.adp && nextPick && p.adp - nextPick > 12) reasons.push(`Usually drafted around #${Math.round(p.adp)}, so you could wait on him`)
    if (p.adp && nextPick && nextPick - p.adp > 20) reasons.push(`Falling: normally gone by #${Math.round(p.adp)}`)
    if (p.inj !== 'ACTIVE') reasons.push(`Injury status: ${p.inj.replace(/_/g, ' ').toLowerCase()}`)
    return { p, v, score, reasons }
  }).filter(Boolean).sort((a, b) => b.score - a.score)
}

// Several of the last picks at one position means other teams are grabbing it.
export function positionRun(recent) {
  for (const pos of POSITIONS) {
    const n = recent.filter((p) => p.pos.includes(pos)).length
    if (recent.length >= 4 && n >= Math.ceil(recent.length / 2)) return { pos, n, of: recent.length }
  }
  return null
}

// Plain-English plan for the round I am picking in.
export function roundTip(round, rounds, settings) {
  if (round <= 2) return 'Take the best player on the board, whatever his position. Stars play big minutes every night and you cannot find them later.'
  if (round <= 6) return 'Still mostly best player available. If a position below says "Take now", lean that way when two players are close.'
  if (round <= rounds - 3) return 'Fill empty starting spots now. An empty slot scores zero on game nights, so a solid starter beats a slightly better bench player.'
  return `Last rounds: bench depth. Pick players whose role may grow (young starters, backups behind injured starters).${settings.format === 'points' ? ' In points leagues, minutes matter most: a 30-minute role player beats a talented 18-minute backup.' : ''}`
}

// ---------- trade ----------

export function evaluateTrade(give, get, values, settings) {
  const sum = (list, f) => list.reduce((s, p) => s + (f(values.get(p.id)) ?? 0), 0)
  const giveVal = sum(give, (v) => v?.val ?? 0)
  const getVal = sum(get, (v) => v?.val ?? 0)
  const cats = CATS.filter((c) => !settings.punt.includes(c.k)).map((c) => ({
    ...c, delta: sum(get, (v) => v?.z[c.k] ?? 0) - sum(give, (v) => v?.z[c.k] ?? 0),
  }))
  const spots = give.length - get.length // >0 means I free roster spots I can fill from waivers
  const delta = getVal - giveVal
  const unit = unitOf(settings)
  const verdict = delta > unit ? 'accept' : delta < -unit ? 'decline' : 'close'
  return { giveVal, getVal, delta, cats, spots, verdict }
}

// ---------- news ----------

export const normName = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z ]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim()

export const NEWS_TAGS = [
  { k: 'out', label: 'Out', tone: 'bad', re: /\b(ruled out|will miss|won't play|will not play|sidelined|out for|out indefinitely|remain(s)? out|not expected to play|miss(es|ed)? (the|his|tuesday|wednesday|thursday|friday|saturday|sunday|monday))/i, why: 'Will not play soon. Bench him; if it lasts weeks, look for a replacement.' },
  { k: 'longterm', label: 'Long-term', tone: 'bad', re: /\b(surgery|season-ending|torn|fracture|weeks|months|indefinitely|reevaluated in)\b/i, why: 'Absence measured in weeks. A roster spot spent on him scores nothing until he returns.' },
  { k: 'injury', label: 'Injury', tone: 'warn', re: /\b(injur|sprain|strain|sore|contusion|concussion|tendin|bruise|knee|ankle|hamstring|achilles|groin|calf|back spasm|illness|sick)/i, why: 'Health issue. Check status before each game.' },
  { k: 'questionable', label: 'Game-time call', tone: 'warn', re: /\b(questionable|doubtful|game-time decision|day-to-day|probable)\b/i, why: 'Might sit. Re-check about an hour before tip-off.' },
  { k: 'personal', label: 'Off-court', tone: 'warn', re: /\b(personal reasons|personal matter|family|bereavement|birth of|paternity|legal|arrest|lawsuit|suspend|investigation|conduct|away from the team|mental health)\b/i, why: 'Off-court news. Can mean missed games with no clear return date.' },
  { k: 'restrict', label: 'Minutes limit', tone: 'warn', re: /\b(minutes restriction|minutes limit|limited minutes|load management|rest(ed|ing)\b|night off|ramp(ing)? up)/i, why: 'Less playing time means fewer stats even when he plays.' },
  { k: 'roleup', label: 'Bigger role', tone: 'good', re: /\b(will start|starting lineup|start(s|ed)? in place|promoted|expanded role|increased role|more minutes|cleared|returns?|back in the lineup|available)\b/i, why: 'More playing time ahead. Worth a look on waivers.' },
  { k: 'move', label: 'Moved', tone: 'info', re: /\b(traded|acquired|waived|released|sign(ed|s) (a|with)|claimed)\b/i, why: 'New team or contract. His role can change in either direction.' },
]
export const tagNews = (text) => NEWS_TAGS.filter((t) => t.re.test(text))
