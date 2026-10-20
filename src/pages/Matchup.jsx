import React, { useEffect, useMemo } from 'react'
import { etToday, gameOn, gamesBetween, weekBounds } from '../lib/model.js'
import { availability, opponentFactor, projectPlayer, weekOutlook } from '../lib/predict.js'
import { recordWeek } from '../lib/grade.js'
import { Tip, fmt } from '../components.jsx'
import { useMatchup } from '../lib/espn.js'
import './matchup.css'

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const SEASON_TAG = '2026-27'

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

// Turn one side of the ESPN matchup into something predict.js can price: a projection per
// player, how many games he has left before Sunday, and who he draws in each of them.
function priceSide(ctx, side, today, weekEnd, currentSeason) {
  const out = []
  let unknown = 0
  for (const p of side.players) {
    const known = ctx.byId.get(p.id)
    const form = ctx.formBy.get(p.id)
    const espnFp = ctx.values.get(p.id)?.fp
    if (espnFp == null && !form) { unknown++; continue } // deep bench, nothing to price him on
    // The live matchup carries its own injury flag, fresher than the player pool's, so it
    // goes in first. One resolver, the same answer the rest of the app gets.
    const { status } = availability({
      inj: p.inj || known?.inj,
      report: ctx.injuryBy.get(p.id),
      news: ctx.newsBy.get(p.id),
    })
    const proj = projectPlayer({ espnFp, form, status, current: currentSeason })
    const games = gamesBetween(ctx.teams[p.team], today, weekEnd)
    // One multiplier per night, in date order: a week against Washington is not a week
    // against Boston. Without the table every night counts at face value, as before.
    const adj = ctx.dvp
      ? games.map((g) => opponentFactor(ctx.dvp, ctx.teams[g.opp]?.abbrev, known?.pos || []))
      : null
    out.push({ id: p.id, name: p.name, ...proj, games: games.length, adj })
  }
  return { players: out, unknown }
}

export default function Matchup({ ctx }) {
  const live = useMatchup(ctx.espn.league && ctx.espn.team ? ctx.espn : null)
  const d = live.data
  const today = etToday()
  const [, weekEnd] = weekBounds(today)
  const slots = ctx.settings.slots.split(',').map((x) => x.trim()).filter(Boolean)
  // Days left in the fantasy week, today included: the lineup cap is per day, not per week,
  // and phase 8 records it so a Thursday forecast is never graded as a full-week claim.
  const daysLeft = Math.max(1, Math.round((new Date(`${weekEnd}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 86400000) + 1)

  // This season's own games get trusted by how many there are; last season's only as a prior.
  const currentSeason = ctx.formCurrent
  const odds = useMemo(() => {
    if (!d?.me || !d?.opp || !ctx.players.length) return null
    const mine = priceSide(ctx, d.me, today, weekEnd, currentSeason)
    const theirs = priceSide(ctx, d.opp, today, weekEnd, currentSeason)
    if (!mine.players.length || !theirs.players.length) return null
    return { ...weekOutlook(mine.players, theirs.players, { starts: slots.length, days: daysLeft }), unknown: mine.unknown + theirs.unknown }
  }, [d, ctx.players, ctx.formBy, ctx.dvp, today, weekEnd, currentSeason, slots.length, daysLeft])

  // Phase 8. Write this week's claim down the first time it is seen and never again: the
  // thing worth grading is what the model said before it knew. recordWeek ignores a week it
  // already holds, so opening the app on Thursday cannot quietly improve Monday's forecast.
  useEffect(() => {
    if (!odds || !d?.matchupPeriod) return
    ctx.setLedger((l) => recordWeek(l, {
      week: d.matchupPeriod,
      season: SEASON_TAG,
      pWin: odds.pWin,
      myMu: odds.me.mu, mySd: odds.me.sd, myGames: odds.me.games,
      oppMu: odds.opp.mu, oppSd: odds.opp.sd, oppGames: odds.opp.games,
      me: d.me?.name ?? null, opp: d.opp?.name ?? null,
      daysLeft,
    }))
  }, [odds, d?.matchupPeriod])

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

          {odds && <Odds odds={odds} updated={ctx.formUpdated} dvp={ctx.dvp} />}
          <div className="sides">
            <Side ctx={ctx} side={d.me} today={today} label="Your day" />
            <Side ctx={ctx} side={d.opp} today={today} label={`${d.opp.name}'s day`} />
          </div>
        </>
      )}
    </div>
  )
}

const pct = (x) => `${Math.round(x * 100)}%`

// The odds, and the four things worth knowing about them.
function Odds({ odds, updated, dvp }) {
  const { pWin, me, opp, gameEdge, swing, danger, matchupEdge } = odds
  const verdict = pWin > 0.8 ? 'You should win this'
    : pWin > 0.6 ? 'You are favoured'
      : pWin > 0.4 ? 'This is a coin flip'
        : pWin > 0.2 ? 'You are the underdog' : 'You need help'

  return (
    <section className="odds">
      <div className="oddshead">
        <span className="big" style={{ color: pWin >= 0.5 ? 'var(--good)' : 'var(--bad)' }}>{pct(pWin)}</span>
        <div>
          <b>{verdict}</b>
          <small>
            Chance of winning the week, from each player's average, how much he swings, how
            often he plays, and the games left on the calendar. Not ESPN's number — ours.
          </small>
        </div>
      </div>

      <ul className="oddsfacts">
        <li><b>{fmt(me.mu, 0)}</b> <span>your projected total, give or take {fmt(me.sd, 0)}</span></li>
        <li><b>{fmt(opp.mu, 0)}</b> <span>his, give or take {fmt(opp.sd, 0)}</span></li>
        <li><b>{gameEdge > 0 ? `+${gameEdge}` : gameEdge}</b> <span>games played edge: {me.games} left against {opp.games}</span></li>
        {danger && <li><b>{fmt(danger.mu, 0)}</b> <span>his biggest threat: {danger.name}, over {danger.games} {danger.games === 1 ? 'game' : 'games'}</span></li>}
        {matchupEdge != null && (
          <li>
            <b>{matchupEdge > 0 ? `+${fmt(matchupEdge, 1)}` : fmt(matchupEdge, 1)}</b>
            <span>
              <Tip text="Your total with the defences your players actually draw this week, minus the same total against an average defence. Guards, forwards and centres are priced separately.">from who you draw</Tip>
              {' '}this week, against an average week
            </span>
          </li>
        )}
      </ul>

      {swing.length > 0 && (
        <>
          <h3>Who the week rests on</h3>
          <table className="t">
            <thead><tr>
              <th>Player</th><th className="num">Games</th><th className="num">Points</th>
              <th className="num"><Tip text="How far the win chance above falls if he misses the rest of the week. Recomputed without him, not a share of the total.">If he sits</Tip></th>
            </tr></thead>
            <tbody>
              {swing.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="num">{p.games}</td>
                  <td className="num">{fmt(p.points, 0)}</td>
                  <td className="num strong">{p.cost > 0.005 ? `−${pct(p.cost)}` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <small className="oddsnote">
        Built on form from {updated ? new Date(updated).toLocaleDateString() : 'the last worker run'}
        {dvp ? `, and on ${dvp.season} defence by position` : ', with no defence table yet'}.
        Player nights are treated as independent, which they are not quite — teammates share a
        ball — so the extremes are a little overconfident. Nothing here is graded yet: that is
        the next thing worth building, and until it exists treat the number as an argument,
        not a fact.
      </small>
    </section>
  )
}
