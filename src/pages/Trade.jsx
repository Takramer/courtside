import React from 'react'
import { evaluateTrade } from '../lib/model.js'
import { fmt } from '../components.jsx'
import { useLocal } from '../lib/store.js'
import { PlayerSearch } from './Team.jsx'

const VERDICT = {
  accept: ['good', 'Take it', 'You get clearly more value than you give.'],
  decline: ['bad', 'Say no', 'You give up clearly more than you get back.'],
  close: ['warn', 'Close call', 'Roughly even. Decide on fit: does it fix a weak category without breaking a strong one?'],
}

export default function Trade({ ctx }) {
  const { values, settings, byId } = ctx
  const [giveIds, setGive] = useLocal('cs.trade.give', [])
  const [getIds, setGet] = useLocal('cs.trade.get', [])
  const give = giveIds.map((id) => byId.get(id)).filter(Boolean)
  const get = getIds.map((id) => byId.get(id)).filter(Boolean)
  const r = give.length && get.length ? evaluateTrade(give, get, values, settings) : null
  const toggle = (set, id) => set((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Trade check</h1>
          <p className="lead">Someone offered you a trade, or you want to propose one? Pick what you give and what you get. Values are per game for the rest of the season.</p>
        </div>
      </div>
      <div className="two">
        <section>
          <h2>You give</h2>
          {ctx.myPlayers.length ? (
            <ul className="pick">
              {ctx.myPlayers.map((p) => (
                <li key={p.id} className={giveIds.includes(p.id) ? 'on' : ''}>
                  <label><input type="checkbox" checked={giveIds.includes(p.id)} onChange={() => toggle(setGive, p.id)} /> {p.name}</label>
                  <span className="num">{fmt(values.get(p.id)?.val)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Add your roster on <a href="#team">My team</a> first.</p>}
        </section>
        <section>
          <h2>You get</h2>
          <PlayerSearch ctx={ctx} filter={(p) => !ctx.mineSet.has(p.id) && !getIds.includes(p.id)} onPick={(p) => setGet((l) => [...l, p.id])} placeholder="Type a player from the other team" />
          <ul className="pick">
            {get.map((p) => (
              <li key={p.id} className="on">
                <span>{p.name}</span>
                <span className="num">{fmt(values.get(p.id)?.val)} <button className="link" onClick={() => toggle(setGet, p.id)}>remove</button></span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {r && (
        <section className={`verdict ${VERDICT[r.verdict][0]}`}>
          <h2>{VERDICT[r.verdict][1]}</h2>
          <p>{VERDICT[r.verdict][2]} You give {fmt(r.giveVal)}, you get {fmt(r.getVal)} (net {r.delta >= 0 ? '+' : ''}{fmt(r.delta)}).</p>
          {r.spots > 0 && <p>You also free {r.spots} roster spot{r.spots > 1 ? 's' : ''} to fill from waivers, which counts in your favor.</p>}
          {r.spots < 0 && <p>You must drop {-r.spots} player{r.spots < -1 ? 's' : ''} to make room. Subtract your worst bench player from the deal.</p>}
          {settings.format === 'cats' && (
            <div className="catdelta">
              {r.cats.map((c) => <span key={c.k} className={`tag ${c.delta > 0.3 ? 'good' : c.delta < -0.3 ? 'bad' : ''}`} title={c.name}>{c.label} {c.delta >= 0 ? '+' : ''}{fmt(c.delta)}</span>)}
            </div>
          )}
          {[...give, ...get].some((p) => ctx.status(p) !== 'ok') && <p>Injury note: {[...give, ...get].filter((p) => ctx.status(p) !== 'ok').map((p) => p.name).join(', ')} {[...give, ...get].filter((p) => ctx.status(p) !== 'ok').length > 1 ? 'are' : 'is'} hurt. Check the news before you agree.</p>}
          <p className="muted">After the trade goes through in your league app, update your roster on <a href="#team">My team</a>.</p>
        </section>
      )}
      {(giveIds.length > 0 || getIds.length > 0) && <button className="btn ghost" onClick={() => { setGive([]); setGet([]) }}>Clear trade</button>}
      <p className="muted">Tip: players in the injury report or with a hot streak often sell for more or less than they are worth. Buy low on stars in a cold patch; sell high on role players in a hot one.</p>
    </div>
  )
}
