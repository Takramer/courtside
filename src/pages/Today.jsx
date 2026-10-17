import React, { useState } from 'react'
import { bestLineup, etToday, fitsSlot, gameOn, gamesBetween, weekBounds } from '../lib/model.js'
import { NewsItem, PlayerName, Tip, ValueTip, fmt } from '../components.jsx'
import './season.css'

const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const nice = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
const tipTime = (g) => new Date(g.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

// What each lineup slot accepts, in words, for someone who has never seen a fantasy lineup.
const SLOT_NAMES = {
  PG: 'Point guard only', SG: 'Shooting guard only', SF: 'Small forward only', PF: 'Power forward only', C: 'Center only',
  G: 'Any guard (PG or SG)', F: 'Any forward (SF or PF)', UT: 'Utility: any position',
}

export default function Today({ ctx }) {
  const today = etToday()
  const [date, setDate] = useState(today)
  const { myPlayers, teams, values, settings, status } = ctx
  const slots = settings.slots.split(',').map((x) => x.trim()).filter(Boolean)

  if (!myPlayers.length) return <Onboarding />

  const playing = myPlayers.filter((p) => gameOn(teams[p.team], date))
  const out = playing.filter((p) => status(p) === 'out')
  const { starters, benched } = bestLineup(playing.filter((p) => status(p) !== 'out'), slots)
  const idle = myPlayers.filter((p) => !gameOn(teams[p.team], date))
  const empty = starters.filter((s) => !s.player).length
  const val = (p) => values.get(p.id)?.val ?? -99

  const worst = myPlayers[myPlayers.length - 1]
  const streams = empty > 0 ? ctx.players.filter((p) => ctx.isFree(p) && gameOn(teams[p.team], date) && status(p) !== 'out')
    .sort((a, b) => val(b) - val(a)).slice(0, 5) : []
  // One suggested free agent per empty slot, best first, never the same man twice.
  const used = new Set()
  const fixFor = starters.map((s) => {
    if (s.player) return null
    const p = streams.find((x) => !used.has(x.id) && fitsSlot(x.pos, s.slot))
    if (p) used.add(p.id)
    return p || null
  })

  const [, wb] = weekBounds(date)
  const weekGames = myPlayers.reduce((s, p) => s + gamesBetween(teams[p.team], date, wb).length, 0)
  const alerts = myPlayers.flatMap((p) => (ctx.newsBy.get(p.id) || []).filter((n) => Date.now() - new Date(n.date) < 36e5 * 72).map((n) => ({ ...n, pid: p.id })))
  const tips = starters.map((s) => s.player && gameOn(teams[s.player.team], date)).filter(Boolean).sort((a, b) => new Date(a.t) - new Date(b.t))
  const first = tips[0]
  // Off days (All-Star break, before opening night) have no games at all: say so once instead of ten red rows.
  const when = date === today ? 'today' : `on ${nice(date).split(',')[0]}`
  const firstFix = fixFor.find(Boolean)
  const noGames = !Object.values(teams).some((t) => gameOn(t, date))
  const nextDay = noGames ? Object.values(teams).flatMap((t) => (t.games || []).map((g) => g.d)).filter((d) => d > date).sort()[0] : null
  const toStream = () => document.getElementById('stream')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })

  return (
    <div className="page season todaypage">
      <div className="pagehead">
        <div>
          <h1>{date === today ? 'Today' : nice(date)}</h1>
          <p className="lead">Set this lineup in your league app before the first game tips off. Players without a game score nothing, so they sit.</p>
        </div>
        <div className="seg">
          <button className={date === today ? 'on' : ''} onClick={() => setDate(today)}>Today</button>
          <button className={date === addDays(today, 1) ? 'on' : ''} onClick={() => setDate(addDays(today, 1))}>Tomorrow</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick a date" />
        </div>
      </div>

      <div className="cards3">
        {noGames ? <div className="stat"><b>Off day</b><span>no NBA games this day, so there is no lineup to set.</span></div> : <div className={`stat ${empty ? 'warn' : 'good'}`}>
          <b>{starters.length - empty}/{slots.length}</b>
          <span>{empty ? <>starting spots filled. {empty} empty spot{empty > 1 ? 's score' : ' scores'} zero{streams.length ? <>: <button className="inline" onClick={toStream}>see who to add</button></> : '.'}</> : 'starting spots filled. Nothing to fix.'}</span>
        </div>}
        <div className="stat">
          <b>{first ? tipTime(first) : '–'}</b>
          <span>{first ? 'first tip-off for your starters. Set your lineup before this.' : 'none of your players have a game this day.'}</span>
        </div>
        <div className="stat">
          <b>{weekGames}</b>
          <span>games left for your roster through {nice(wb).split(',')[0]}. More games means more stats.</span>
        </div>
      </div>

      {noGames ? (
        <div className="emptystate">
          <b>No NBA games {date === today ? 'today' : 'on this day'}.</b>
          <p>Nobody scores, so your lineup does not matter. {nextDay ? `The next games are on ${nice(nextDay)}.` : ''}</p>
          {nextDay && <div className="row"><button className="btn ghost" onClick={() => setDate(nextDay)}>Show {nice(nextDay).split(',')[0]}'s lineup</button></div>}
        </div>
      ) : <>
      <section>
        <div className="sechead">
          <h2>Start these</h2>
          <span className="muted"><ValueTip settings={settings} /> = how much better than a free agent</span>
        </div>
        <ul className="lineup">
          {starters.map((s, i) => {
            const g = s.player && gameOn(teams[s.player.team], date)
            const fix = fixFor[i]
            const fg = fix && gameOn(teams[fix.team], date)
            return (
              <li key={i} className={s.player ? '' : 'empty'}>
                <Tip text={SLOT_NAMES[s.slot] || s.slot}><span className="slotchip">{s.slot}</span></Tip>
                {s.player ? <>
                  <span className="who"><PlayerName ctx={ctx} p={s.player} /></span>
                  <span className="game">{g && <>{g.home ? 'vs' : '@'} <b>{teams[g.opp]?.abbrev}</b> · {tipTime(g)}</>}</span>
                  <span className="val num">{fmt(values.get(s.player.id)?.val)}</span>
                </> : (
                  <span className="fix">
                    <b className="bad">Empty: none of your players can fill {s.slot} {when}.</b>
                    {fix
                      ? <span className="fixrow">Best fix: <PlayerName ctx={ctx} p={fix} /> <span className="muted">{fg && <>{fg.home ? 'vs' : '@'} {teams[fg.opp]?.abbrev} · {tipTime(fg)} · </>}value {fmt(values.get(fix.id)?.val)}</span>
                        <button className={`btn sm ${fix === firstFix ? '' : 'ghost'}`} onClick={() => ctx.moveTo(fix.id, 'mine')}>I added him</button></span>
                      : <span className="muted">No free agent who plays {when} fits this spot.</span>}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {empty > 0 && streams.length > 0 && (
        <section className="callout" id="stream">
          <h2>Fill your {empty} empty spot{empty > 1 ? 's' : ''}: free agents who play {when}</h2>
          <p>An empty spot scores zero. Adding one of these for the day ("streaming") gets you extra stats. To make room, drop your lowest-value player{worst ? <> (<b>{worst.name}</b>)</> : ''}, unless he is a long-term asset. Do it in your league app, then tap "I added him" here.</p>
          <ul className="plain rows">
            {streams.map((p) => (
              <li key={p.id}>
                <span className="grow"><PlayerName ctx={ctx} p={p} /> <span className="muted">value {fmt(values.get(p.id)?.val)}, on {fmt(p.own, 0)}% of ESPN teams</span></span>
                <button className="btn ghost sm" onClick={() => ctx.moveTo(p.id, 'mine')}>I added him</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Bench these</h2>
        {out.length > 0 && <>
          <h3>Ruled out ({out.length})</h3>
          <ul className="plain">
            {out.map((p) => <li key={p.id}><PlayerName ctx={ctx} p={p} /> <span className="why bad">{ctx.injuryBy.get(p.id)?.comment || 'on the injury report'}</span></li>)}
          </ul>
        </>}
        {benched.length > 0 && <>
          <h3>Plays, but no spot left ({benched.length})</h3>
          <p className="hint">Your starters are better, or no open spot fits his position.</p>
          <ul className="plain">{benched.map((p) => <li key={p.id}><PlayerName ctx={ctx} p={p} /></li>)}</ul>
        </>}
        {idle.length > 0 && <>
          <h3>No game {date === today ? 'today' : 'this day'} ({idle.length})</h3>
          <ul className="plain">{idle.map((p) => <li key={p.id}><PlayerName ctx={ctx} p={p} /></li>)}</ul>
        </>}
        {!out.length && !benched.length && !idle.length && <p className="muted">Nobody. Everyone on your roster starts.</p>}
      </section>
      </>}

      {alerts.length > 0 && (
        <section>
          <h2>News on your players (last 3 days)</h2>
          <ul className="newslist">{alerts.slice(0, 12).map((n, i) => <NewsItem key={i} n={n} ctx={ctx} showName />)}</ul>
        </section>
      )}
    </div>
  )
}

const STEPS = [
  ['#league', 'Tell it about your league', 'Pick categories or points (your league\'s settings page says which), the number of teams and your draft slot.', '3 minutes'],
  ['#draft', 'Draft, or add the team you have', 'Use Draft live during your draft: mark each pick and it tells you who to take. Already drafted? Add your players on My team.', 'During your draft'],
  ['#learn', 'Learn the basics', 'New to basketball or fantasy? This explains positions, categories and what to do each day.', '10 minutes'],
]

function Onboarding() {
  return (
    <div className="page season narrow onboard">
      <h1>Welcome. Three steps to get going.</h1>
      <p className="lead">Once your team is in, this page shows who to start, who to sit and which free agents to grab. Come back every day before games start.</p>
      <ol className="stepcards">
        {STEPS.map(([href, title, body, time], i) => (
          <li key={href}>
            <a href={href}>
              <span className="n">{i + 1}</span>
              <span className="body"><b>{title}</b><span>{body}</span><small>{time}</small></span>
              <span className="go" aria-hidden="true">→</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}
