import React from 'react'
import { etToday, gameOn } from '../lib/model.js'
import { fmt } from '../components.jsx'
import { useMatchup } from '../lib/espn.js'
import './matchup.css'

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

// One player's day: where he is playing, and what he has scored so far.
function Line({ ctx, p, today }) {
  const pro = ctx.teams[p.team]
  const g = gameOn(pro, today)
  const known = ctx.byId.get(p.id)
  const out = p.inj === 'OUT' || p.inj === 'INJURY_RESERVE' || p.inj === 'SUSPENSION'
  return (
    <tr className={p.starting ? '' : 'bench'}>
      <td className="slot">{p.slot}</td>
      <td>
        {known ? <button className="link" onClick={() => ctx.open(p.id)}>{p.name}</button> : p.name}
        {out && <span className="tag bad">out</span>}
      </td>
      <td className="opp">{g ? `${g.home ? 'vs' : '@'} ${ctx.teams[g.opp]?.abbrev ?? '–'} ${time(g.t)}` : 'no game'}</td>
      <td className="num strong">{p.points == null ? '–' : fmt(p.points, 1)}</td>
    </tr>
  )
}

function Side({ ctx, side, today, label }) {
  const starters = side.players.filter((p) => p.starting)
  const bench = side.players.filter((p) => !p.starting)
  return (
    <div className="side">
      <h3>{label}</h3>
      <div className="scroll">
      <table className="t">
        <thead><tr><th>Slot</th><th>Player</th><th>Game</th><th className="num">Today</th></tr></thead>
        <tbody>
          {starters.map((p, i) => <Line key={`s${p.id}${i}`} ctx={ctx} p={p} today={today} />)}
          {bench.length > 0 && <tr className="split"><td colSpan="4">Bench — these score nothing</td></tr>}
          {bench.map((p, i) => <Line key={`b${p.id}${i}`} ctx={ctx} p={p} today={today} />)}
        </tbody>
      </table>
      </div>
    </div>
  )
}

export default function Matchup({ ctx }) {
  const live = useMatchup(ctx.espn.league && ctx.espn.team ? ctx.espn : null)
  const d = live.data
  const today = etToday()

  if (!ctx.espn.league || !ctx.espn.team) {
    return (
      <div className="page narrow">
        <h1>This week</h1>
        <p className="lead">Live scoring comes straight from your ESPN league, so it needs the league connected first.</p>
        <p><a className="btn" href="#league">Connect my league</a></p>
      </div>
    )
  }

  const lead = d?.me && d?.opp ? d.me.week - d.opp.week : 0

  return (
    <div className="page matchuppage">
      <div className="pagehead">
        <div>
          <h1>This week</h1>
          <p className="lead">Your head-to-head as ESPN has it. Points land a minute or two after the box score moves.</p>
        </div>
        <div className="headmeta">
          <span className={`livetag ${live.loading ? 'on' : ''}`}>{live.at ? `Updated ${time(live.at)}` : 'Reading ESPN…'}</span>
          <button className="btn ghost sm" onClick={live.reload} disabled={live.loading}>Refresh</button>
        </div>
      </div>

      {live.error && <p className="banner bad">{live.error}</p>}

      {d && !d.me && <p className="banner">ESPN has no matchup for you in week {d.matchupPeriod} yet. It appears once the league schedule is up.</p>}

      {d?.me && d?.opp && (
        <>
          <section className="score">
            <div className={`team ${lead > 0 ? 'ahead' : ''}`}>
              <span className="tname">{d.me.name}</span>
              <b>{fmt(d.me.week, 1)}</b>
              <small>{fmt(d.me.today, 1)} today</small>
            </div>
            <span className="vs">vs</span>
            <div className={`team ${lead < 0 ? 'ahead' : ''}`}>
              <span className="tname">{d.opp.name}</span>
              <b>{fmt(d.opp.week, 1)}</b>
              <small>{fmt(d.opp.today, 1)} today</small>
            </div>
          </section>
          <p className="verdict">
            {lead === 0 ? 'Dead level.' : lead > 0 ? `You are ahead by ${fmt(lead, 1)}.` : `You are behind by ${fmt(-lead, 1)}.`}
            {' '}Week {d.matchupPeriod}, day {d.scoringPeriod}.
          </p>
          <div className="sides">
            <Side ctx={ctx} side={d.me} today={today} label="Your day" />
            <Side ctx={ctx} side={d.opp} today={today} label={`${d.opp.name}'s day`} />
          </div>
        </>
      )}
    </div>
  )
}
