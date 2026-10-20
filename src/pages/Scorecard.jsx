import React, { useEffect, useMemo } from 'react'
import { isFullWeek, score, settle } from '../lib/grade.js'
import { useHistory } from '../lib/espn.js'
import { Tip, fmt } from '../components.jsx'
import './season.css'

const pct = (x) => `${Math.round(x * 100)}%`
// Rounded before the sign is chosen, so a gap of -0.4 reads 0 rather than -0.
const signed = (x, d = 1) => { const r = +x.toFixed(d) || 0; return r > 0 ? `+${fmt(r, d)}` : fmt(r, d) }

// Forecasts grouped by how sure they were, against how often those weeks were won.
function Buckets({ rows }) {
  return (
    <table className="t">
      <thead><tr>
        <th>When it said</th><th className="num">Weeks</th>
        <th className="num">It meant</th><th className="num">Won</th><th className="num">Gap</th>
      </tr></thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.from}>
            <td>{pct(b.from)}&ndash;{pct(b.to)}</td>
            <td className="num">{b.n}</td>
            <td className="num">{pct(b.said)}</td>
            <td className="num strong">{pct(b.actual)}</td>
            <td className="num" style={{ color: Math.abs(b.actual - b.said) > 0.2 ? 'var(--bad)' : undefined }}>
              {signed((b.actual - b.said) * 100, 0)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Phase 9. The ledger needs a season before its probability can be read; this needs none.
// Last season, one week at a time, priced with only what was known that Monday.
function Replay({ bt, sdScale }) {
  if (!bt) {
    return (
      <section className="odds">
        <h3>Last season, replayed</h3>
        <p className="lead">Not run yet. <code>npm run backtest</code> on the Mac writes it, in about a second.</p>
      </section>
    )
  }
  const { points: p, holdout: h, dvp, level } = bt
  const dvpNote = Math.abs(dvp.brierWith - dvp.brierWithout) < 0.001 ? 'no measurable difference'
    : dvp.brierWith < dvp.brierWithout ? 'it helps' : 'it hurts'
  return (
    <section className="odds">
      <h3>Last season, replayed</h3>
      <p className="lead">
        {bt.graded.toLocaleString()} matchups from {bt.season}, in {bt.leagues} imaginary leagues.
        Each was priced on its Monday with only the games before it, then played out of the
        real box scores. Form only: no ESPN projection and no injury report, so it grades the
        spread, availability, the nightly lineup cap and the bell curve — not the whole engine.
      </p>
      <div className="oddshead">
        <span className="big" style={{ color: bt.brier < bt.baseline ? 'var(--good)' : 'var(--bad)' }}>{fmt(bt.brier, 3)}</span>
        <div>
          <b>{bt.brier < bt.baseline ? 'Better than a coin' : 'Worse than a coin — this is broken'}</b>
          <small>Brier score against {fmt(bt.baseline, 2)} for saying &ldquo;50%&rdquo; every week.</small>
        </div>
      </div>
      <ul className="oddsfacts">
        <li>
          <b>{pct(p.within1sd)}</b>
          <span>landed inside its own spread — it claims {pct(p.expected1sd)}</span>
        </li>
        <li>
          <b>{signed(p.bias)}</b>
          <span>
            <Tip text="Actual minus projected, per team-week. Negative means it projects high. Part of this is the replay itself: form alone, with no ESPN projection to pull a hot streak back to earth.">bias</Tip>
            {' '}per team-week, typical miss {fmt(p.mae, 0)}
          </span>
        </li>
        {level && (
          <li>
            <b>{fmt(level.brierWithout, 3)}</b>
            <span>
              <Tip text="The same weeks with every night priced as an independent draw. The gap is what pricing a man's nights as moving together is worth.">if every night were independent</Tip>
            </span>
          </li>
        )}
        <li>
          <b>{fmt(dvp.brierWithout, 3)}</b>
          <span>without the defence table — {dvpNote}</span>
        </li>
        <li>
          <b>&times;{fmt(sdScale, 2)}</b>
          <span>
            <Tip text={`The live spread correction: this replay as the starting point, your graded weeks taking over as they come in. Fitted on the first ${h.fitWeeks} replayed weeks alone, it moved the other ${h.testWeeks} from ${fmt(h.brierRaw, 3)} to ${fmt(h.brierScaled, 3)}.`}>spread correction</Tip>
            {' '}on this week&rsquo;s odds
          </span>
        </li>
      </ul>
      <h4>Where it is wrong</h4>
      <Buckets rows={bt.buckets} />
      <small className="muted">Replayed {new Date(bt.updated).toLocaleDateString()}. {bt.note}</small>
    </section>
  )
}

export default function Scorecard({ ctx }) {
  const conn = ctx.espn.league && ctx.espn.team ? ctx.espn : null
  const hist = useHistory(conn)

  // Finals come from ESPN, not from the last score the app happened to see. Settling is
  // idempotent, so doing it on every visit costs nothing and fixes any week that was open
  // the last time you looked.
  useEffect(() => {
    if (!hist.weeks?.length) return
    ctx.setLedger((l) => settle(l, hist.weeks))
  }, [hist.weeks])

  const s = useMemo(() => score(ctx.ledger), [ctx.ledger])
  const rows = useMemo(
    () => Object.values(ctx.ledger || {}).sort((a, b) => b.week - a.week),
    [ctx.ledger],
  )

  if (!conn) {
    return (
      <div className="page narrow scorecard">
        <h1>Scorecard</h1>
        <p className="lead">
          Grading needs your league connected: the forecast comes from here, the result comes from ESPN.
        </p>
        <p><a className="btn" href="#league">Connect my league</a></p>
        <Replay bt={ctx.backtest} sdScale={ctx.sdScale} />
      </div>
    )
  }

  return (
    <div className="page narrow season scorecard">
      <div className="pagehead">
        <div>
          <h1>Scorecard</h1>
          <p className="lead">
            What this app said, against what happened. Every week's forecast is written down
            before the games and never edited afterwards. If the numbers here are bad, they
            are supposed to say so.
          </p>
        </div>
      </div>

      {hist.error && <p className="banner bad">Could not read past weeks from ESPN: {hist.error}</p>}

      <Replay bt={ctx.backtest} sdScale={ctx.sdScale} />

      <h3>Your league, this season</h3>

      {s.graded === 0 ? (
        <div className="emptystate">
          <b>Nothing graded yet.</b>
          <p>
            {s.pending > 0
              ? `${s.pending} week${s.pending > 1 ? 's' : ''} recorded and still running. The first grade lands when ESPN closes the week.`
              : 'Open This week once while a matchup is live and the forecast gets written down. Grading starts from there.'}
          </p>
          <div className="row"><a className="btn" href="#week">Go to This week</a></div>
        </div>
      ) : (
        <>
          <section className="odds">
            <h3>The points projection</h3>
            <p className="lead">
              Gradeable from the first week: one number predicted, one number scored. This is
              the part worth reading early.
            </p>
            <ul className="oddsfacts">
              <li><b>{s.points.n}</b> <span>team-weeks graded, yours and his</span></li>
              <li>
                <b>{signed(s.points.bias)}</b>
                <span>
                  <Tip text="Average of actual minus predicted. Positive means the projection runs low: teams score more than it says. A steady bias is the easiest thing here to fix.">bias</Tip>
                  {' '}per week{s.points.bias > 0 ? ' — it is projecting low' : s.points.bias < 0 ? ' — it is projecting high' : ''}
                </span>
              </li>
              <li>
                <b>{fmt(s.points.mae)}</b>
                <span><Tip text="Average size of the miss, ignoring direction. Compare it to a weekly total of a thousand-odd points.">typical miss</Tip>, either way</span>
              </li>
              <li>
                <b>{pct(s.points.within1sd)}</b>
                <span>
                  <Tip text="The model claims about 68% of weeks land within one standard deviation of the projection. Far below means it is overconfident and the win probabilities are too extreme; far above means it is hedging.">landed inside its own spread</Tip>
                  {' '}— it claims {pct(s.points.expected1sd)}
                </span>
              </li>
            </ul>
            {s.points.n < 12 && (
              <small className="muted">
                {s.points.n} team-week{s.points.n > 1 ? 's' : ''} is not enough to call any of this a
                pattern. It is here so it accumulates, not so it can be read today.
              </small>
            )}
          </section>

          <section className="odds">
            <h3>The win probability</h3>
            <div className="oddshead">
              <span className="big" style={{ color: s.beatsCoin ? 'var(--good)' : 'var(--bad)' }}>{fmt(s.brier, 3)}</span>
              <div>
                <b>
                  {!s.enoughForProbability ? 'Too early to judge'
                    : s.beatsCoin ? 'Better than a coin' : 'Worse than a coin — this is broken'}
                </b>
                <small>
                  <Tip text="Brier score: the average squared error of the probabilities. Zero is perfect. Saying 50% every week without looking at anything scores 0.25, so anything above that line means the model is adding noise, not information.">Brier score</Tip>
                  {' '}against a baseline of {fmt(s.baseline, 2)}, which is what saying
                  &ldquo;50%&rdquo; every week scores. Record {s.record.won}&ndash;{s.record.lost}.
                </small>
              </div>
            </div>
            {!s.enoughForProbability && (
              <p className="banner warn">
                {s.graded} graded week{s.graded === 1 ? '' : 's'}. A probability cannot be
                checked against a handful of outcomes — one 65% that lost tells you nothing —
                so treat this number as a placeholder until there are about {s.minForProbability}.
              </p>
            )}
            {s.buckets.length > 0 && (
              <>
                <h4>Where it is wrong</h4>
                <Buckets rows={s.buckets} />
                <small className="muted">
                  A model can be right overall and badly wrong in one band. Over-confidence
                  shows up here as a big negative gap in the 70&ndash;100% rows.
                </small>
              </>
            )}
          </section>

          <h3>Week by week</h3>
          <div className="scroll">
            <table className="t">
              <thead><tr>
                <th>Week</th><th>Opponent</th><th className="num">Said</th>
                <th className="num">Projected</th><th className="num">Scored</th>
                <th className="num">Miss</th><th>Result</th>
              </tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.week}>
                    <td>
                      {e.week}
                      {!isFullWeek(e) && <Tip text={`Recorded with ${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'} left, so part of the week had already been played. A weaker claim than a Monday forecast.`}><span className="tag">part week</span></Tip>}
                    </td>
                    <td>{e.opp ?? '–'}</td>
                    <td className="num">{pct(e.pWin)}</td>
                    <td className="num">{fmt(e.myMu, 0)}</td>
                    <td className="num">{e.final ? fmt(e.final.my, 0) : '–'}</td>
                    <td className="num">{e.final ? signed(e.final.my - e.myMu, 0) : '–'}</td>
                    <td>
                      {!e.final ? <span className="muted">running</span>
                        : e.final.tie ? <span className="tag">tie</span>
                          : <span className={`tag ${e.final.won ? 'good' : 'bad'}`}>{e.final.won ? 'won' : 'lost'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small className="muted">
            Ties are left out of every number above: they are neither a win nor a loss and
            counting them either way would flatter or punish the model for nothing. Weeks
            marked &ldquo;part week&rdquo; were first seen after the week had started, so the
            forecast already knew some results — they are graded, but they are a weaker claim
            than a Monday one.
          </small>
        </>
      )}
    </div>
  )
}
