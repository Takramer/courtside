import React, { useState } from 'react'
import { bestLineup, etToday, gameOn, gamesBetween, weekBounds } from '../lib/model.js'
import { NewsItem, PlayerName, fmt } from '../components.jsx'

const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const nice = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
const tipTime = (g) => new Date(g.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

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

  const worst = myPlayers[myPlayers.length - 1]
  const streams = empty > 0 ? ctx.players.filter((p) => ctx.isFree(p) && gameOn(teams[p.team], date) && status(p) !== 'out')
    .sort((a, b) => (values.get(b.id)?.val ?? -99) - (values.get(a.id)?.val ?? -99)).slice(0, 5) : []

  const [, wb] = weekBounds(date)
  const weekGames = myPlayers.reduce((s, p) => s + gamesBetween(teams[p.team], date, wb).length, 0)
  const alerts = myPlayers.flatMap((p) => (ctx.newsBy.get(p.id) || []).filter((n) => Date.now() - new Date(n.date) < 36e5 * 72).map((n) => ({ ...n, pid: p.id })))

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>{date === today ? 'Today' : nice(date)}</h1>
          <p className="lead">Set this lineup in your league app before the first game tips off. Players without a game today score nothing, so they sit.</p>
        </div>
        <div className="seg">
          <button className={date === today ? 'on' : ''} onClick={() => setDate(today)}>Today</button>
          <button className={date === addDays(today, 1) ? 'on' : ''} onClick={() => setDate(addDays(today, 1))}>Tomorrow</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
      </div>

      <div className="cards3">
        <div className="stat"><b>{starters.length - empty}/{slots.length}</b><span>starting spots filled</span></div>
        <div className="stat"><b>{out.length}</b><span>players ruled out</span></div>
        <div className="stat"><b>{weekGames}</b><span>games left this week (thru {nice(wb).split(',')[0]})</span></div>
      </div>

      <section>
        <h2>Start these</h2>
        <table className="t">
          <thead><tr><th>Slot</th><th>Player</th><th>Game</th><th className="num">Value</th></tr></thead>
          <tbody>
            {starters.map((s, i) => {
              const g = s.player && gameOn(teams[s.player.team], date)
              return (
                <tr key={i} className={s.player ? '' : 'emptyrow'}>
                  <td className="slot">{s.slot}</td>
                  <td>{s.player ? <PlayerName ctx={ctx} p={s.player} /> : <span className="muted">Empty: nobody eligible plays today</span>}</td>
                  <td>{g ? `${g.home ? 'vs' : '@'} ${teams[g.opp]?.abbrev} · ${tipTime(g)}` : ''}</td>
                  <td className="num">{s.player ? fmt(values.get(s.player.id)?.val) : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {empty > 0 && streams.length > 0 && (
        <section className="callout">
          <h2>Fill your {empty} empty spot{empty > 1 ? 's' : ''}: free agents who play today</h2>
          <p>An empty slot scores zero. Adding one of these for today ("streaming") gets you extra stats. To make room, drop your lowest-value player{worst ? <> (<b>{worst.name}</b>)</> : ''}, unless he is a long-term asset.</p>
          <ul className="plain">
            {streams.map((p) => <li key={p.id}><PlayerName ctx={ctx} p={p} /> <span className="muted">value {fmt(values.get(p.id)?.val)}, on {fmt(p.own, 0)}% of ESPN teams</span></li>)}
          </ul>
        </section>
      )}

      <section>
        <h2>Bench these</h2>
        <ul className="plain">
          {out.map((p) => <li key={p.id}><PlayerName ctx={ctx} p={p} /> <span className="why bad">ruled out: {ctx.injuryBy.get(p.id)?.comment || 'injury report'}</span></li>)}
          {benched.map((p) => <li key={p.id}><PlayerName ctx={ctx} p={p} /> <span className="why">plays today, but your starters are better or no open slot fits his position</span></li>)}
          {idle.map((p) => <li key={p.id}><PlayerName ctx={ctx} p={p} /> <span className="why">no game today</span></li>)}
        </ul>
      </section>

      {alerts.length > 0 && (
        <section>
          <h2>News on your players (last 3 days)</h2>
          <ul className="newslist">{alerts.slice(0, 12).map((n, i) => <NewsItem key={i} n={n} ctx={ctx} showName />)}</ul>
        </section>
      )}
    </div>
  )
}

function Onboarding() {
  return (
    <div className="page narrow">
      <h1>Welcome. Three steps to get going.</h1>
      <ol className="steps">
        <li><b>Tell it about your league.</b> Open <a href="#league">League setup</a> and pick categories or points (your league's settings page says which), the number of teams, and your draft slot. 3 minutes.</li>
        <li><b>Draft, or add the team you already have.</b> Use <a href="#draft">Draft</a> live during your draft: mark each pick as yours or someone else's and it tells you who to take. Already drafted? Click players and choose "On my team".</li>
        <li><b>Come back every day before games start.</b> This page will then show who to start, who to sit and which free agents to grab. New to all of it? Read <a href="#learn">Learn</a> first (10 minutes).</li>
      </ol>
    </div>
  )
}
