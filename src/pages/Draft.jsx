import React, { useMemo, useRef, useState } from 'react'
import { draftSuggestions, likelyGone, positionOutlook, positionRun, roundTip, snakePicks } from '../lib/model.js'
import { PlayerName, ValueTip, ZCell, catHeaders, fmt } from '../components.jsx'
import { useLocal } from '../lib/store.js'
import './draft.css'

const POS = ['All', 'PG', 'SG', 'SF', 'PF', 'C']
const LEVEL = { now: ['bad', 'Take now'], soon: ['warn', 'Take soon'], wait: ['info', 'Can wait'], covered: ['good', 'Have enough'] }

export default function Draft({ ctx }) {
  const { settings, values, mineSet, takenSet, players } = ctx
  const [log, setLog] = useLocal('cs.draftlog', [])
  const [q, setQ] = useState('')
  const [pos, setPos] = useState('All')
  const [showTaken, setShowTaken] = useState(false)
  const searchRef = useRef(null)

  const picks = snakePicks(settings.teams, settings.draftSlot, settings.rosterSize)
  const current = ctx.mine.length + ctx.taken.length + 1
  const nextPick = picks.find((x) => x >= current)
  const followingPick = picks.find((x) => x > nextPick)
  const onClock = current === nextPick
  const done = !nextPick

  // Back to the search box after every mark, so the next pick is type + Enter. Skipped on touch screens: it would pop the keyboard.
  const refocus = () => { if (matchMedia('(pointer: fine)').matches) searchRef.current?.focus() }
  const pick = (id, who) => { ctx.setOwner(id, who); setLog((l) => [...l, id]); setQ(''); refocus() }
  const undo = () => { const id = log[log.length - 1]; if (id == null) return; ctx.setOwner(id, 'free'); setLog((l) => l.slice(0, -1)); refocus() }
  const lastMarked = ctx.byId.get(log[log.length - 1])
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
    if (e.key === 'Escape') setQ('')
    if (e.key !== 'Enter' || !match) return
    pick(match.id, 'taken')
  }

  const board = players
    .filter((p) => showTaken || (!mineSet.has(p.id) && !takenSet.has(p.id)))
    .filter((p) => q || pos === 'All' || p.pos.includes(pos)) // a name search ignores the position filter
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (values.get(a.id)?.draftRank ?? 999) - (values.get(b.id)?.draftRank ?? 999))
    .slice(0, 250)
  const cats = catHeaders(settings)
  const match = q && board[0] && !mineSet.has(board[0].id) && !takenSet.has(board[0].id) ? board[0] : null

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Draft room</h1>
          <p className="lead">Keep this open next to ESPN. When another team picks, type the name in the box at the top and press Enter. When you pick, press <b>Draft</b> on that player. The page then tells you who to take next.</p>
        </div>
        <div className="seg">
          <span className="muted leaguefacts">{settings.teams} teams · slot {settings.draftSlot} · <a href="#league">change</a></span>
          <button onClick={reset}>Reset draft</button>
        </div>
      </div>

      {/* Sticky: clock status, the search used on every pick, and undo never scroll away. */}
      <div className={`clockbar ${onClock ? 'on' : ''}`}>
        <div className="clock" aria-live="polite">
          <b>{done ? 'Draft done' : onClock ? 'You are on the clock' : `Pick #${current} · round ${round}`}</b>
          <span>{done ? 'your roster is full' : onClock ? `pick #${current} · round ${round}` : `your pick is #${nextPick}, ${picksUntilMe} ${picksUntilMe === 1 ? 'pick' : 'picks'} away`}</span>
        </div>
        {onClock && suggestions[0] && <button className="btn" onClick={() => pick(suggestions[0].p.id, 'mine')}>Draft {suggestions[0].p.name}</button>}
        <div className="find">
          <input ref={searchRef} aria-label="Search player. Enter marks the top match Taken" placeholder="Type a name, Enter marks Taken" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} />
          <small aria-live="polite">{!q ? '' : match ? <>Enter marks <b>{match.name}</b> Taken{board.length > 1 ? ` · ${board.length - 1} more ${board.length === 2 ? 'match' : 'matches'}` : ''}</> : 'No player left with that name'}</small>
        </div>
        <button className="btn ghost" onClick={undo} disabled={!log.length} title={lastMarked?.name}>Undo{lastMarked ? ` ${lastMarked.name}` : ''}</button>
      </div>

      {!done && (
        <section>
          <h2>{onClock ? 'Take one of these now' : `Likely still there at pick #${nextPick}`}</h2>
          {run && <div className="banner warn">Teams are taking {run.pos}s: {run.n} of the last {run.of} picks. If you need one, take one soon.</div>}
          <div className="suggest">
            {suggestions.map((s, i) => (
              <div className="card" key={s.p.id}>
                <div className="rankno">{i + 1}</div>
                <PlayerName ctx={ctx} p={s.p} />
                <div className="muted">Value {fmt(s.v.seasonVal)} · Usual pick {s.p.adp ? Math.round(s.p.adp) : '–'}</div>
                <ul>{(s.reasons.length ? s.reasons : ['Highest value still available']).map((r, j) => <li key={j}>{r}</li>)}</ul>
                <button className="btn" onClick={() => pick(s.p.id, 'mine')}>Draft him</button>
              </div>
            ))}
          </div>
          {!onClock && gone.length > 0 && (
            <p className="muted">Probably gone before your turn: {gone.slice(0, 9).map((p) => p.name).join(', ')}{gone.length > 9 ? ' and more' : ''}. The cards above leave them out and update as real picks come in.</p>
          )}
        </section>
      )}

      {sinceMine.length > 0 && (
        <section>
          <h3>Other teams' picks since yours</h3>
          <p className="muted">{sinceMine.map((p) => `${p.name} (${p.pos.join('/')})`).join(' · ')}</p>
        </section>
      )}
      {theirs.length === 0 && !done && <p className="muted">When another team picks, type the name in the search box and press Enter to mark him Taken.</p>}

      {!done && (
        <section>
          <h2>Round {round} of {settings.rosterSize}: the plan</h2>
          <p>{roundTip(round, settings.rosterSize, settings)}</p>
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

      <section>
        <div className="filters">
          <div className="seg">{POS.map((x) => <button key={x} className={pos === x ? 'on' : ''} onClick={() => setPos(x)}>{x}</button>)}</div>
          <label><input type="checkbox" checked={showTaken} onChange={(e) => setShowTaken(e.target.checked)} /> show drafted</label>
        </div>
        <div className="scroll">
          <table className="t">
            <thead>
              <tr>
                <th>#</th><th>Player</th><th className="num" title="Where people usually draft him (average pick in ESPN drafts)">ADP</th><th className="num"><ValueTip settings={settings} /></th>
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
