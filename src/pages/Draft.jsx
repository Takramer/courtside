import React, { useMemo, useState } from 'react'
import { draftSuggestions, likelyGone, positionOutlook, positionRun, roundTip, snakePicks } from '../lib/model.js'
import { PlayerName, ValueTip, ZCell, catHeaders, fmt } from '../components.jsx'
import { useLocal } from '../lib/store.js'

const POS = ['All', 'PG', 'SG', 'SF', 'PF', 'C']
const LEVEL = { now: ['bad', 'Take now'], soon: ['warn', 'Soon'], wait: ['info', 'Can wait'], covered: ['good', 'Covered'] }

export default function Draft({ ctx }) {
  const { settings, values, mineSet, takenSet, players } = ctx
  const [log, setLog] = useLocal('cs.draftlog', [])
  const [q, setQ] = useState('')
  const [pos, setPos] = useState('All')
  const [showTaken, setShowTaken] = useState(false)

  const picks = snakePicks(settings.teams, settings.draftSlot, settings.rosterSize)
  const current = ctx.mine.length + ctx.taken.length + 1
  const nextPick = picks.find((x) => x >= current)
  const followingPick = picks.find((x) => x > nextPick)
  const onClock = current === nextPick
  const done = !nextPick

  const pick = (id, who) => { ctx.setOwner(id, who); setLog((l) => [...l, id]) }
  const undo = () => { const id = log[log.length - 1]; if (id == null) return; ctx.setOwner(id, 'free'); setLog((l) => l.slice(0, -1)) }
  const reset = () => { if (confirm('Clear every pick, including your own team?')) { ctx.setMine([]); ctx.setTaken([]); setLog([]) } }

  const available = useMemo(() => players.filter((p) => !mineSet.has(p.id) && !takenSet.has(p.id)), [players, mineSet, takenSet])
  const picksUntilMe = nextPick ? nextPick - current : 0
  // Forecast from ADP: who the other teams take before my next pick, and before the one after.
  const gone = useMemo(() => likelyGone(available, picksUntilMe), [available, picksUntilMe])
  const goneLater = useMemo(() => (followingPick ? likelyGone(available, followingPick - current) : gone), [available, followingPick, current, gone])
  const suggestions = useMemo(() => draftSuggestions({ available, mine: ctx.myPlayers, values, settings, nextPick, followingPick, gone, goneLater }).slice(0, 3),
    [available, ctx.myPlayers, values, settings, nextPick, followingPick, gone, goneLater])
  const outlook = positionOutlook({ available, mine: ctx.myPlayers, values, settings, gone, goneLater })
  const round = Math.min(settings.rosterSize, Math.ceil(current / settings.teams))

  // What the other teams just did: their picks since my last one, and any rush on one position.
  const lastMine = log.findLastIndex((id) => mineSet.has(id))
  const theirs = log.filter((id) => takenSet.has(id))
  const sinceMine = log.slice(lastMine + 1).filter((id) => takenSet.has(id)).map((id) => ctx.byId.get(id)).filter(Boolean)
  const run = positionRun(theirs.slice(-6).map((id) => ctx.byId.get(id)).filter(Boolean))

  const onSearchKey = (e) => {
    if (e.key !== 'Enter' || !q || !board[0] || mineSet.has(board[0].id) || takenSet.has(board[0].id)) return
    pick(board[0].id, 'taken'); setQ('')
  }

  const board = players
    .filter((p) => showTaken || (!mineSet.has(p.id) && !takenSet.has(p.id)))
    .filter((p) => pos === 'All' || p.pos.includes(pos))
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (values.get(a.id)?.draftRank ?? 999) - (values.get(b.id)?.draftRank ?? 999))
    .slice(0, 250)
  const cats = catHeaders(settings)

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Draft room</h1>
          <p className="lead">Keep this open during your draft. After every pick in your real draft, find that player here and press <b>Mine</b> or <b>Taken</b>. The top of the page then tells you who to take next.</p>
        </div>
        <div className="seg">
          <button onClick={undo} disabled={!log.length}>Undo last</button>
          <button onClick={reset}>Reset draft</button>
        </div>
      </div>

      <div className="cards3">
        <div className="stat"><b>#{done ? '–' : current}</b><span>pick on the clock</span></div>
        <div className={`stat ${onClock ? 'hot' : ''}`}><b>{done ? 'Done' : onClock ? 'YOU' : `#${nextPick}`}</b><span>{done ? 'your roster is full' : onClock ? 'you are picking now' : `your next pick (${picksUntilMe} picks away)`}</span></div>
        <div className="stat"><b>{settings.teams} teams · slot {settings.draftSlot}</b><span><a href="#league">change in League setup</a></span></div>
      </div>

      {!done && (
        <section>
          <h2>Round {round} of {settings.rosterSize}: the plan</h2>
          <p>{roundTip(round, settings.rosterSize, settings)}</p>
          {run && <div className="banner warn">Run on {run.pos}: {run.n} of the last {run.of} picks were {run.pos}s. Other teams are grabbing them, so the good ones left will not last.</div>}
          <div className="pos5">
            {outlook.map((o) => (
              <div key={o.pos} className={`poscard ${o.level}`}>
                <div><b>{o.pos}</b> <span className={`tag ${LEVEL[o.level][0]}`}>{LEVEL[o.level][1]}</span></div>
                <small>You have {o.have}. {o.why}</small>
              </div>
            ))}
          </div>
        </section>
      )}

      {!done && (
        <section>
          <h2>{onClock ? 'Take one of these now' : `Likely still there at pick #${nextPick}`}</h2>
          <div className="suggest">
            {suggestions.map((s, i) => (
              <div className="card" key={s.p.id}>
                <div className="rankno">{i + 1}</div>
                <PlayerName ctx={ctx} p={s.p} />
                <div className="muted">Value {fmt(s.v.seasonVal)} · ADP {s.p.adp ? Math.round(s.p.adp) : '–'}</div>
                <ul>{(s.reasons.length ? s.reasons : ['Best value left on the board']).map((r, j) => <li key={j}>{r}</li>)}</ul>
                <button className="btn" onClick={() => pick(s.p.id, 'mine')}>Draft him (Mine)</button>
              </div>
            ))}
          </div>
          {!onClock && gone.length > 0 && (
            <p className="muted">Likely gone before your turn ({picksUntilMe} picks): {gone.slice(0, 9).map((p) => p.name).join(', ')}{gone.length > 9 ? ' and more' : ''}. These cards skip them, so they update as the real picks come in.</p>
          )}
        </section>
      )}

      {sinceMine.length > 0 && (
        <section>
          <h3>Since your last pick</h3>
          <p className="muted">{sinceMine.map((p) => `${p.name} (${p.pos.join('/')})`).join(' · ')}</p>
        </section>
      )}
      {theirs.length === 0 && !done && <p className="muted">When another team picks, type the name in the search box and press Enter to mark him Taken.</p>}

      <section>
        <div className="filters">
          <input placeholder="Search player, Enter = Taken" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} />
          <div className="seg">{POS.map((x) => <button key={x} className={pos === x ? 'on' : ''} onClick={() => setPos(x)}>{x}</button>)}</div>
          <label><input type="checkbox" checked={showTaken} onChange={(e) => setShowTaken(e.target.checked)} /> show drafted</label>
        </div>
        <div className="scroll">
          <table className="t">
            <thead>
              <tr>
                <th>#</th><th>Player</th><th className="num" title="Average draft position across ESPN drafts">ADP</th><th className="num"><ValueTip settings={settings} /></th>
                {settings.format === 'cats' ? cats.map((c) => <th key={c.k} className="num" title={c.name}>{c.label}</th>) : <th className="num">FPTS/G</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {board.map((p) => {
                const v = values.get(p.id)
                const owner = mineSet.has(p.id) ? 'mine' : takenSet.has(p.id) ? 'taken' : null
                const steal = p.adp && v && p.adp - v.draftRank > 15
                return (
                  <tr key={p.id} className={owner ? `own-${owner}` : ''}>
                    <td className="num muted">{v?.draftRank ?? '–'}</td>
                    <td><PlayerName ctx={ctx} p={p} />{steal && <span className="tag good" title="We rank him well above where people usually draft him">value pick</span>}</td>
                    <td className="num">{p.adp ? fmt(p.adp, 0) : '–'}</td>
                    <td className="num strong">{fmt(v?.seasonVal)}</td>
                    {settings.format === 'cats' ? cats.map((c) => <ZCell key={c.k} z={v?.z[c.k]} />) : <td className="num">{fmt(v?.fp)}</td>}
                    <td className="actions">
                      {owner ? <button className="btn ghost sm" onClick={() => { ctx.setOwner(p.id, 'free'); setLog((l) => l.filter((x) => x !== p.id)) }}>Undo</button> : <>
                        <button className="btn sm" onClick={() => pick(p.id, 'mine')}>Mine</button>
                        <button className="btn ghost sm" onClick={() => pick(p.id, 'taken')}>Taken</button>
                      </>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
