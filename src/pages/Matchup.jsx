import React from 'react'
import { etToday, gameOn } from '../lib/model.js'
import { Tip, fmt, sfmt } from '../components.jsx'
import { NightBars, OutcomeDots, RaceBars } from '../charts.jsx'

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const pct = (x) => `${Math.round(x * 100)}%`

function Side({ ctx, side, today, label }) {
  return (
    <div className="side">
      <h3>{label}</h3>
      <table className="t compact">
        <thead><tr><th>Slot</th><th>Player</th><th>Game</th><th className="num">Pts</th></tr></thead>
        <tbody>
          {[...side.players.filter((p) => p.starting), ...side.players.filter((p) => !p.starting)].map((p, i) => {
            const g = gameOn(ctx.teams[p.team], today)
            const out = ['OUT', 'INJURY_RESERVE', 'SUSPENSION'].includes(p.inj)
            return (
              <tr key={`${p.id}${i}`} className={p.starting ? '' : 'bench'}>
                <td className="slot">{p.slot}</td>
                <td>{ctx.byId.get(p.id) ? <button className="link" onClick={() => ctx.open(p.id)}>{p.name}</button> : p.name}{out && <span className="badge out">OUT</span>}</td>
                <td className="muted">{g ? `${g.home ? 'vs' : '@'} ${ctx.teams[g.opp]?.abbrev ?? '–'} ${time(g.t)}` : '–'}</td>
                <td className="num">{p.points == null ? '–' : fmt(p.points, 1)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Matchup({ ctx }) {
  const { live, odds, backtest: bt } = ctx
  const d = live.data
  const today = etToday()
  const slots = ctx.settings.slots.split(',').map((x) => x.trim()).filter(Boolean).length
  const track = bt?.graded > 0 && <p className="track">Tested on {bt.graded.toLocaleString()} matchups from last season.</p>

  if (!ctx.espn.league || !ctx.espn.team) {
    return (
      <div className="page matchuppage">
        <h1>Matchup</h1>
        <div className="emptystate">
          <b>Connect your ESPN league to see the matchup.</b>
          <div className="row"><a className="btn" href="#league">Connect league</a></div>
        </div>
        {track}
      </div>
    )
  }

  const lead = d?.me && d?.opp ? d.me.week - d.opp.week : 0

  return (
    <div className="page matchuppage">
      <div className="pagehead">
        <h1>{d?.opp ? <>Week {d.matchupPeriod} <span className="muted">vs {d.opp.name}</span></> : 'Matchup'}</h1>
        <div className="tools">
          <span className="muted">{live.at ? `Updated ${time(live.at)}` : 'Reading ESPN…'}</span>
          <button className="btn ghost" onClick={live.reload} disabled={live.loading}>Refresh</button>
        </div>
      </div>

      {live.error && <p className="banner bad">{live.error}</p>}
      {d && !d.me && <p className="banner">No matchup in week {d.matchupPeriod} yet.</p>}

      {d?.me && d?.opp && (
        <>
          {odds && (
            <section className="hero" aria-label="Win odds">
              <p className="heroline"><span className="big">{pct(odds.pWin)}</span><span className="heroword">to win</span></p>
              <p className="herosub">
                Score {fmt(d.me.week, 1)} to {fmt(d.opp.week, 1)}, {lead === 0 ? 'level' : lead > 0 ? `up ${fmt(lead, 1)}` : `down ${fmt(-lead, 1)}`}.
                {' '}Projected {fmt(odds.me.mu, 0)} to {fmt(odds.opp.mu, 0)}.
              </p>
            </section>
          )}
          {!odds && <p className="herosub">Score {fmt(d.me.week, 1)} to {fmt(d.opp.week, 1)}.</p>}

          {odds && <Odds odds={odds} oppName={d.opp.name} slots={slots} today={today} />}

          <details className="fold-sec">
            <summary>Today's box score</summary>
            <div className="sides">
              <Side ctx={ctx} side={d.me} today={today} label="You" />
              <Side ctx={ctx} side={d.opp} today={today} label={d.opp.name} />
            </div>
          </details>
        </>
      )}
      {track}
    </div>
  )
}

function Odds({ odds, oppName, slots, today }) {
  const { me, opp, swing, danger, matchupEdge } = odds
  const maxCost = Math.max(0.01, ...swing.map((p) => p.cost))
  const [myNights, oppNights] = odds.load
  const edge = myNights.reduce((n, v) => n + Math.min(v, slots), 0) - oppNights.reduce((n, v) => n + Math.min(v, slots), 0)

  return (
    <>
      <section aria-labelledby="ends-h">
        <h2 id="ends-h">20 ways the week ends</h2>
        <OutcomeDots q={odds.q} oppName={oppName} />
      </section>

      <section aria-labelledby="race-h">
        <h2 id="race-h">Scored and projected</h2>
        <RaceBars rows={[
          { name: 'You', tone: 'you', now: me.banked, mu: me.mu, sd: me.sd },
          { name: oppName, tone: 'opp', now: opp.banked, mu: opp.mu, sd: opp.sd },
        ]} />
      </section>

      <section aria-labelledby="nights-h">
        <h2 id="nights-h">Nights left</h2>
        <NightBars dates={odds.nights} slots={slots} today={today} series={[
          { name: 'You', tone: 'you', values: myNights },
          { name: oppName, tone: 'opp', values: oppNights },
        ]} />
        <p className="note">
          {edge === 0 ? 'Even on usable games.' : <><b>{edge > 0 ? 'You' : oppName}</b> {edge > 0 ? 'have' : 'has'} {Math.abs(edge)} more usable game{Math.abs(edge) === 1 ? '' : 's'}.</>}
          {matchupEdge != null && <> <Tip text="This week's defences, back-to-backs and returns, against a plain week">Schedule</Tip>: {sfmt(matchupEdge, 1)} pts.</>}
          {danger && <> Their biggest threat: <b>{danger.name}</b>, {fmt(danger.mu, 0)} pts.</>}
        </p>
      </section>

      {swing.length > 0 && (
        <section aria-labelledby="swing-h">
          <h2 id="swing-h">Who the week rests on</h2>
          <table className="t swing">
            <thead><tr>
              <th>Player</th><th className="num">Games</th><th className="num">Pts</th>
              <th className="num"><Tip text="Win chance lost if he sits the rest of the week">If he sits</Tip></th>
            </tr></thead>
            <tbody>
              {swing.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="num">{p.games}</td>
                  <td className="num">{fmt(p.points, 0)}</td>
                  <td className="heat"><i style={{ '--o': (Math.max(0, p.cost) / maxCost) ** 0.6 * 0.5 }} /><span>{p.cost > 0.005 ? `−${pct(p.cost)}` : '–'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}
