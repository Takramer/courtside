import React from 'react'
import { evaluateTrade } from '../lib/model.js'
import { fmt } from '../components.jsx'
import { useLocal } from '../lib/store.js'
import { PlayerSearch } from './Team.jsx'
import './extras.css'

const VERDICT = {
  accept: ['good', 'Take it', 'You get clearly more value than you give.'],
  decline: ['bad', 'Say no', 'You give up clearly more than you get back.'],
  close: ['warn', 'Close call', 'Roughly even. Decide on fit: does it fix a weak category without breaking a strong one?'],
}
const signed = (x) => `${x >= 0 ? '+' : ''}${fmt(x)}`

export default function Trade({ ctx }) {
  const { values, settings, byId, teams } = ctx
  const [giveIds, setGive] = useLocal('cs.trade.give', [])
  const [getIds, setGet] = useLocal('cs.trade.get', [])
  const give = giveIds.map((id) => byId.get(id)).filter(Boolean)
  const get = getIds.map((id) => byId.get(id)).filter(Boolean)
  const r = give.length && get.length ? evaluateTrade(give, get, values, settings) : null
  const toggle = (set, id) => set((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  const total = (list) => list.reduce((s, p) => s + (values.get(p.id)?.val ?? 0), 0)
  const sub = (p) => `${teams[p.team]?.abbrev || 'FA'} · ${p.pos.join('/')}`
  const hurt = [...give, ...get].filter((p) => ctx.status(p) !== 'ok')
  const clear = () => {
    const g = giveIds; const t = getIds
    setGive([]); setGet([])
    ctx.toast('Trade cleared', { action: { label: 'Undo', onClick: () => { setGive(g); setGet(t) } } })
  }
  const nextStep = !give.length && !get.length ? 'Tick at least one player you give and add one you get.'
    : !give.length ? 'Now tick who you give from your roster.' : 'Now add who you get from the other team.'

  return (
    <div className="page tradepage">
      <div className="pagehead">
        <div>
          <h1>Trade check</h1>
          <p className="lead">Someone offered you a trade, or you want to propose one? Pick what you give and what you get. Values are per game for the rest of the season.</p>
        </div>
        {(giveIds.length > 0 || getIds.length > 0) && <button className="btn ghost sm" onClick={clear}>Clear trade</button>}
      </div>

      <div className="deal">
        <section className="side give" aria-labelledby="give-h">
          <header>
            <h2 id="give-h">You give</h2>
            <span className="sidetotal"><small>{give.length} player{give.length === 1 ? '' : 's'} · value</small><b className="num">{fmt(total(give))}</b></span>
          </header>
          {ctx.myPlayers.length ? (
            <ul className="pick">
              {ctx.myPlayers.map((p) => (
                <li key={p.id} className={giveIds.includes(p.id) ? 'on' : ''}>
                  <label>
                    <input type="checkbox" checked={giveIds.includes(p.id)} onChange={() => toggle(setGive, p.id)} />
                    <span className="grow">{p.name} <small>{sub(p)}</small></span>
                    <span className="num">{fmt(values.get(p.id)?.val)}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : <div className="empty"><b>Your roster is empty.</b> Add your players on <a href="#team">My team</a>, then come back to pick who you give.</div>}
        </section>

        <div className="swap" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></svg>
        </div>

        <section className="side get" aria-labelledby="get-h">
          <header>
            <h2 id="get-h">You get</h2>
            <span className="sidetotal"><small>{get.length} player{get.length === 1 ? '' : 's'} · value</small><b className="num">{fmt(total(get))}</b></span>
          </header>
          <PlayerSearch ctx={ctx} filter={(p) => !ctx.mineSet.has(p.id) && !getIds.includes(p.id)} onPick={(p) => setGet((l) => [...l, p.id])} placeholder="Type a player from the other team" />
          {get.length ? (
            <ul className="pick">
              {get.map((p) => (
                <li key={p.id} className="on">
                  <span className="grow"><button className="link" onClick={() => ctx.open(p.id)}>{p.name}</button> <small>{sub(p)}</small></span>
                  <span className="num">{fmt(values.get(p.id)?.val)}</span>
                  <button className="rm" onClick={() => toggle(setGet, p.id)} aria-label={`Remove ${p.name}`} title="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          ) : <div className="empty">Type two or more letters of a name above to add each player you would receive.</div>}
        </section>
      </div>

      <div aria-live="polite">
        {r ? (
          <section className={`verdict tv ${VERDICT[r.verdict][0]}`}>
            <div className="tvhead">
              <div><small>Verdict</small><h2>{VERDICT[r.verdict][1]}</h2></div>
              <div className="tvnet"><small>Net value</small><b className="num">{signed(r.delta)}</b></div>
            </div>
            <p className="tvwhy">{VERDICT[r.verdict][2]}</p>
            <p className="tvmath">You give <b className="num">{fmt(r.giveVal)}</b> and get <b className="num">{fmt(r.getVal)}</b>.</p>
            {r.spots > 0 && <p>You also free {r.spots} roster spot{r.spots > 1 ? 's' : ''} to fill from waivers, which counts in your favor.</p>}
            {r.spots < 0 && <p>You must drop {-r.spots} player{r.spots < -1 ? 's' : ''} to make room. Subtract your worst bench player from the deal.</p>}
            {settings.format === 'cats' && (
              <div className="catdelta">
                {r.cats.map((c) => <span key={c.k} className={`tag ${c.delta > 0.3 ? 'good' : c.delta < -0.3 ? 'bad' : ''}`} title={c.name}>{c.label} {signed(c.delta)}</span>)}
              </div>
            )}
            {hurt.length > 0 && <p className="tvinj">Injury note: {hurt.map((p) => p.name).join(', ')} {hurt.length > 1 ? 'are' : 'is'} hurt. Check the news before you agree.</p>}
            <p className="muted">After the trade goes through in your league app, update your roster on <a href="#team">My team</a>.</p>
          </section>
        ) : (
          <section className="tvempty">
            <b>The verdict shows up here.</b>
            <p>{nextStep}</p>
          </section>
        )}
      </div>

      <p className="muted tiptext">Tip: players in the injury report or with a hot streak often sell for more or less than they are worth. Buy low on stars in a cold patch; sell high on role players in a hot one.</p>
    </div>
  )
}
