// npm run teamcheck: the roster read the way the app reads it, printed as a short Markdown
// report. Runs anywhere with Node 22 and the network to reach ESPN, RotoWire and Google News
// — the twice-daily cloud check runs exactly this, so its report and the dashboard agree.
//
// The league is private and its cookies never leave the browser, so this cannot see your
// ESPN roster. It watches DEFAULT_ROSTER in src/lib/model.js instead: when you make a move,
// change that list (the app itself only reads it on a first visit, so editing it is safe).
// For the same reason "probably free" below is a guess from ESPN-wide ownership, the way the
// app guesses before a league is connected.
import playersApi from '../api/players.js'
import newsApi from '../api/news.js'
import { DEFAULT_ROSTER, DEFAULT_SETTINGS, bestLineup, computeValues, etToday, gameOn, gamesBetween, normName, splitIR, tagNews, weekBounds } from '../src/lib/model.js'
import { availability, isB2B, priceGames, projectPlayer } from '../src/lib/predict.js'
import { rankMoves } from '../src/lib/decide.js'
import { readFileSync } from 'node:fs'

// Call a Vercel handler in-process: no server, no Vercel CLI.
const call = (handler, query = {}) => new Promise((resolve, reject) => {
  const res = {
    setHeader() {},
    status(code) { this.code = code; return this },
    json(body) { (this.code >= 400 ? reject(new Error(body.error || `status ${this.code}`)) : resolve(body)) },
  }
  Promise.resolve(handler({ method: 'GET', query }, res)).catch(reject)
})

const s = DEFAULT_SETTINGS
const today = etToday()
const [, weekEnd] = weekBounds(today)
const time = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
const f1 = (x) => (x == null ? '–' : x.toFixed(1))
// Surname, skipping a suffix: Porter, not Jr.
const last = (name) => name.split(' ').filter((w) => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(w)).slice(-1)[0]

const [pdata, ndata] = await Promise.all([call(playersApi), call(newsApi)])
const { players, teams } = pdata
const byId = new Map(players.map((p) => [p.id, p]))
const idByName = new Map(players.map((p) => [normName(p.name), p.id]))
const values = computeValues(players, s)
const val = (p) => values.get(p.id)?.val ?? -99

const mineIds = DEFAULT_ROSTER.map((n) => idByName.get(normName(n))).filter(Boolean)
const missing = DEFAULT_ROSTER.filter((n) => !idByName.has(normName(n)))
const sweep = await call(newsApi, { players: mineIds.map((id) => byId.get(id).name).sort().join('|') }).catch(() => ({ news: [] }))

// The same joins App.jsx makes: RotoWire by name, ESPN headlines by athlete id, the injury
// report by name, the press sweep by name and only when it carries a tag.
const newsBy = new Map(); const injuryBy = new Map(); const offCourtBy = new Map()
const push = (m, id, item) => { if (!m.has(id)) m.set(id, []); m.get(id).push(item) }
for (const n of ndata.news || []) {
  const item = { ...n, tags: tagNews(`${n.title} ${n.body}`) }
  const ids = n.ids?.length ? n.ids.filter((id) => byId.has(id)) : [idByName.get(normName(n.name))].filter(Boolean)
  ids.forEach((id) => push(newsBy, id, item))
}
for (const i of ndata.injuries || []) { const id = idByName.get(normName(i.name)); if (id) injuryBy.set(id, i) }
for (const n of sweep.news || []) {
  const item = { ...n, tags: tagNews(`${n.title} ${n.body || ''}`) }
  const id = idByName.get(normName(n.name))
  if (item.tags.length && id) push(offCourtBy, id, item)
}
const avail = (p) => availability({ inj: p.inj, report: injuryBy.get(p.id), news: newsBy.get(p.id), offCourt: offCourtBy.get(p.id) })

const mine = mineIds.map((id) => byId.get(id)).sort((a, b) => val(b) - val(a))
const { active, ir } = splitIR(mine, (p) => avail(p).status === 'out', s.ir)
const slots = s.slots.split(',').map((x) => x.trim()).filter(Boolean)
const games = (p) => gamesBetween(teams[p.team], today, weekEnd)

// Tonight: who has a game, and whether that is more men than there are slots.
const tonight = active.map((p) => ({ p, g: gameOn(teams[p.team], today), a: avail(p) })).filter((r) => r.g)
const playable = tonight.filter((r) => r.a.status !== 'out')
const lineup = bestLineup(playable.map((r) => r.p), slots)
const starting = new Set(lineup.starters.filter((r) => r.player).map((r) => r.player.id))
const benchedTonight = playable.filter((r) => !starting.has(r.p.id))
const hurt = mine.map((p) => ({ p, ...avail(p) })).filter((r) => r.status !== 'ok')
const flagged = mine.map((p) => ({ p, ...avail(p) })).filter((r) => r.flags.length)
// RotoWire items are about one man by construction. An ESPN headline is attached to every
// player it tags, so a league-wide roundup lands on half the roster: keep it only when it
// names him.
const fresh = mine.flatMap((p) => (newsBy.get(p.id) || [])
  .filter((n) => Date.now() - Date.parse(n.date) < 24 * 3600e3 && (n.src === 'RotoWire' || n.title.includes(last(p.name))))
  .map((n) => ({ p, n })))

// The waiver idea comes from the decision layer the app uses (src/lib/decide.js), priced the
// way the app prices a side: projection, then per-game play chance and opponent from priceGames.
const worst = active[active.length - 1]
const readData = (f) => { try { return JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8')) } catch { return null } }
const form = readData('form.json')
const dvp = readData('dvp.json')
const formBy = new Map((form?.players || []).map((r) => [r.norm, r]))
// A form.json more than 3 days old has its recent misses ignored (spec, change 0).
const formFresh = !!form && Date.now() - Date.parse(form.updated) < 3 * 864e5
const now = Date.now()
const plus = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const nextMon = plus(weekEnd, 1)
function price(p) {
  const a = avail(p)
  const f = formBy.get(normName(p.name))
  const cal = teams[p.team]?.games || []
  // A game that has tipped is already in ESPN's score, as in today.js priceSide.
  const sched = (from, to) => gamesBetween(teams[p.team], from, to).filter((g) => g.d > today || g.t > now)
    .map((g) => ({ d: g.d, opp: teams[g.opp]?.abbrev, b2b: isB2B(cal, g.d) }))
  const opts = { today, status: a.status, longOut: a.longOut, form: f, formFresh, dvp, pos: p.pos }
  const wk = priceGames({ games: sched(today, weekEnd), ...opts })
  const tip = gameOn(teams[p.team], today)
  return {
    id: p.id, name: p.name, pos: p.pos, status: a.status, longOut: a.longOut, val: val(p),
    ...projectPlayer({ espnFp: values.get(p.id)?.fp, form: f, status: a.status, current: !!form?.is_current_season, formFresh }),
    ...wk, games: wk.dates.length, next: priceGames({ games: sched(nextMon, plus(nextMon, 6)), ...opts }),
    irEligible: ['OUT', 'INJURY_RESERVE'].includes(p.inj), locked: !!tip && tip.t <= now,
  }
}
// "Free" is a guess from ESPN-wide ownership: the league is private. The 40 most valuable are
// enough; rankMoves looks at 12 for swaps.
const free = players.filter((p) => !mineIds.includes(p.id) && p.own < s.ownCutoff && avail(p).status === 'ok')
  .sort((a, b) => val(b) - val(a)).slice(0, 40)
const nights = Array.from({ length: 7 }, (_, i) => plus(weekBounds(today)[0], i)).filter((d) => d >= today)
// ponytail: the real IR is not visible from here; splitIR's guess stands in for it, and its
// men are left out of the move list rather than offered for activation.
const ideas = rankMoves({
  today, nights, slots, rosterSize: s.rosterSize, roster: active.map(price), irOpen: Math.max(0, s.ir - ir.length),
  free: free.map(price), opp: null, max: 4,
}).filter((m) => m.kind !== 'start')
const hot = active.filter((p) => (values.get(p.id)?.trend ?? 0) > 4)
const cold = active.filter((p) => (values.get(p.id)?.trend ?? 0) < -4)

// ---- the report: the answer first, then the reasons
const out = []
const outStarters = hurt.filter((r) => r.status === 'out' && gameOn(teams[r.p.team], today) && !ir.includes(r.p))
const dtdTonight = hurt.filter((r) => r.status === 'dtd' && gameOn(teams[r.p.team], today))
const headline = outStarters.length
  ? `Action: ${outStarters.map((r) => r.p.name).join(', ')} ${outStarters.length > 1 ? 'are' : 'is'} ruled out tonight. Bench ${outStarters.length > 1 ? 'them' : 'him'} in ESPN.`
  : dtdTonight.length
    ? `Watch: ${dtdTonight.map((r) => r.p.name).join(', ')} ${dtdTonight.length > 1 ? 'are game-time decisions' : 'is a game-time decision'} tonight.`
    : playable.length
      ? `All clear: ${playable.length} of your players go tonight, and none of them is hurt.`
      : 'No games for your roster tonight.'
out.push(`# Courtside team check, ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })}`)
out.push('', `**${headline}**`, '')

out.push(`## Tonight: ${tonight.length} of your players have a game`)
if (tonight.length) {
  for (const { p, g, a } of tonight.sort((x, y) => x.g.t - y.g.t)) {
    const tag = a.status === 'out' ? ' — **OUT**' : a.status === 'dtd' ? ' — **GTD**' : benchedTonight.some((r) => r.p.id === p.id) ? ' — no slot left, bench' : ''
    out.push(`- ${p.name} ${g.home ? 'vs' : '@'} ${teams[g.opp]?.abbrev ?? '?'}, ${time(g.t)} ET${tag}`)
  }
  if (benchedTonight.length) out.push('', `${playable.length} healthy players for ${slots.length} slots: ${benchedTonight.length} sit${benchedTonight.length === 1 ? 's' : ''} no matter what.`)
} else out.push('- Nobody plays today.')

out.push('', '## Hurt or flagged')
if (!hurt.length && !flagged.length) out.push('- Nobody hurt, nobody in the news.')
for (const r of hurt) out.push(`- ${r.p.name}: **${r.status === 'out' ? 'OUT' : 'GTD'}**${r.why ? ` — ${r.why}` : ''}${r.source ? ` (${r.source})` : ''}${ir.includes(r.p) ? ' · on IR' : ''}`)
for (const r of flagged) out.push(`- ${r.p.name}: off the court — ${r.flags.map((x) => x.title).join(' · ')} (read it, it changes no number)`)

out.push('', '## Rest of the week')
const total = active.reduce((n, p) => n + games(p).length, 0)
out.push(`- ${total} games left for your active roster through Sunday ${weekEnd.slice(5)}.`)
const thin = active.filter((p) => games(p).length <= 1)
if (thin.length) out.push(`- One game or fewer: ${thin.map((p) => `${last(p.name)} (${games(p).length})`).join(', ')}.`)
if (hot.length) out.push(`- Hot: ${hot.map((p) => `${last(p.name)} (+${f1(values.get(p.id).trend)} pts/g)`).join(', ')}.`)
if (cold.length) out.push(`- Cold: ${cold.map((p) => `${last(p.name)} (${f1(values.get(p.id).trend)} pts/g)`).join(', ')}.`)

out.push('', '## Waiver idea')
const sign = (x) => `${x >= 0 ? '+' : ''}${f1(x)}`
const moves = ideas.filter((m) => m.kind !== 'hold')
if (moves.length) {
  for (const m of moves) {
    const own = byId.get(m.add)?.own
    out.push(`- ${m.title}: ${sign(m.gainPts)} pts this week, ${sign(m.gainNext)} next. ${m.reason[0].toUpperCase()}${m.reason.slice(1)}.${own != null ? ` Owned in ${own.toFixed(0)}% of ESPN leagues.` : ''}${m.blocked ? ` (${m.blocked})` : ''}`)
  }
  out.push('', `"Free" is a guess from ESPN-wide ownership under ${s.ownCutoff}%: check your league before you add.`)
} else out.push(`- Nobody probably free beats ${worst ? last(worst.name) : 'your weakest player'} this week by enough to bother.`)
if (!formFresh) out.push(`- form.json is from ${form?.updated?.slice(0, 10) ?? 'nowhere'}: recent missed games are not read until the worker runs.`)

if (fresh.length) {
  out.push('', '## News in the last 24 hours')
  for (const { p, n } of fresh.slice(0, 5)) out.push(`- ${p.name}: ${n.title} (${n.src})`)
}

out.push('', `_Roster watched: DEFAULT_ROSTER in src/lib/model.js (${mine.length} players). Data read ${time(Date.now())} ET._`)
if (missing.length) out.push(`_Not found in ESPN's player pool, so not checked: ${missing.join(', ')}._`)
console.log(out.join('\n'))
