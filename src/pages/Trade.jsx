import React, { useMemo } from 'react'
import { etToday, evaluateTrade, weekBounds } from '../lib/model.js'
import { tradeCheck } from '../lib/decide.js'
import { priceSide, priceWeek, weekDates } from './today.js'
import { fmt } from '../components.jsx'
import { TradeScale } from '../charts.jsx'
import { useLocal } from '../lib/store.js'
import { PlayerSearch } from './Team.jsx'

const VERDICT = {
  accept: ['good', 'Take it', 'You get clearly more than you give.'],
  decline: ['bad', 'Say no', 'You give clearly more than you get.'],
  close: ['warn', 'Close call', 'Roughly even; decide on fit.'],
}
const signed = (x, d) => `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x), d)}`
const plus = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

// Points leagues: the trade priced by the engine (tradeCheck, src/lib/decide.js) over this week
// and every week left, in expected wins, with the roster made legal. Categories leagues keep
// the season-value check: teamWeek prices fantasy points, not categories.
function engineCheck(ctx, give, get) {
  const s = ctx.settings
  const today = etToday()
  const [weekStart, weekEnd] = weekBounds(today)
  const now = Date.now()
  const slots = s.slots.split(',').map((x) => x.trim()).filter(Boolean)
  const price = (players) => priceSide(ctx, { players }, today, weekEnd, ctx.formCurrent, now, { keep: true }).players
  const val = (p) => ctx.values.get(p.id)?.val ?? -99
  const free = ctx.players.filter((p) => ctx.isFree(p) && ctx.status(p) !== 'out').sort((a, b) => val(b) - val(a)).slice(0, 15)
  // Weeks left: the league's count when connected, else every week the NBA schedule still has.
  const lastGame = Object.values(ctx.teams).flatMap((t) => (t.games || []).map((g) => g.d)).sort().at(-1) ?? weekEnd
  const n = ctx.linked && ctx.league.weeksLeft != null ? ctx.league.weeksLeft
    : Math.max(0, Math.ceil((Date.parse(lastGame) - Date.parse(plus(weekEnd, 1))) / (7 * 864e5)))
  const weeks = Array.from({ length: n }, (_, i) => ({ start: plus(weekEnd, 1 + 7 * i), end: plus(weekEnd, 7 + 7 * i) }))
  const r = tradeCheck({
    // The roster's size today, not the league's: a spot already open is not the trade's to fill.
    today, slots, nights: weekDates(weekStart).filter((x) => x >= today), rosterSize: ctx.activePlayers.length,
    roster: price(ctx.activePlayers), free: price(free), weeks, sdScale: ctx.sdScale,
    priceWeek: (players, w) => priceWeek(ctx, players, w, now),
  }, { give: give.map((p) => p.id), get: price(get) })
  return { ...r, weeks: n }
}

export default function Trade({ ctx }) {
  const { values, settings, byId, teams } = ctx
  const [giveIds, setGive] = useLocal('cs.trade.give', [])
  const [getIds, setGet] = useLocal('cs.trade.get', [])
  const give = giveIds.map((id) => byId.get(id)).filter(Boolean)
  const get = getIds.map((id) => byId.get(id)).filter(Boolean)
  const r = give.length && get.length ? evaluateTrade(give, get, values, settings) : null
  const pts = settings.format === 'points'
  const e = useMemo(() => (r && pts ? engineCheck(ctx, give, get) : null),
    [giveIds.join(), getIds.join(), pts, ctx.activePlayers, ctx.players, ctx.formBy, ctx.league.weeksLeft, ctx.sdScale])
  const name = (id) => byId.get(id)?.name ?? 'a free agent'
  const toggle = (set, id) => set((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  const total = (list) => list.reduce((s, p) => s + (values.get(p.id)?.val ?? 0), 0)
  const sub = (p) => `${teams[p.team]?.abbrev || 'FA'} · ${p.pos.join('/')}`
  const hurt = [...give, ...get].filter((p) => ctx.status(p) !== 'ok')
  const clear = () => {
    const g = giveIds; const t = getIds
    setGive([]); setGet([])
    ctx.toast('Trade cleared', { action: { label: 'Undo', onClick: () => { setGive(g); setGet(t) } } })
  }
  const nextStep = !give.length && !get.length ? 'Pick who you give and who you get.'
    : !give.length ? 'Pick who you give.' : 'Add who you get.'

  return (
    <div className="page tradepage">
      <div className="pagehead">
        <h1>Trade</h1>
        {(giveIds.length > 0 || getIds.length > 0) && <button className="btn ghost" onClick={clear}>Clear</button>}
      </div>

      <div className="deal">
        <section className="side give" aria-labelledby="give-h">
          <header>
            <h2 id="give-h">You give</h2>
            <span className="sidetotal"><b className="num">{fmt(total(give))}</b></span>
          </header>
          {ctx.myPlayers.length ? (
            <ul className="pick">
              {ctx.myPlayers.map((p) => (
                <li key={p.id} className={giveIds.includes(p.id) ? 'on' : ''}>
                  <label>
                    <input type="checkbox" checked={giveIds.includes(p.id)} onChange={() => toggle(setGive, p.id)} />
                    <span className="grow"><span className="pn">{p.name}</span> <span className="muted">{sub(p)}</span></span>
                    <span className="num">{fmt(values.get(p.id)?.val)}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : <div className="empty">Your roster is empty. <a href="#team">Add players</a></div>}
        </section>

        <div className="swap" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></svg>
        </div>

        <section className="side get" aria-labelledby="get-h">
          <header>
            <h2 id="get-h">You get</h2>
            <span className="sidetotal"><b className="num">{fmt(total(get))}</b></span>
          </header>
          <PlayerSearch ctx={ctx} filter={(p) => !ctx.mineSet.has(p.id) && !getIds.includes(p.id)} onPick={(p) => setGet((l) => [...l, p.id])} placeholder="Add a player you get" />
          {get.length ? (
            <ul className="pick">
              {get.map((p) => (
                <li key={p.id} className="on">
                  <button className="rm" onClick={() => toggle(setGet, p.id)} aria-label={`Remove ${p.name}`} title="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                  <span className="grow"><button className="link pn" onClick={() => ctx.open(p.id)}>{p.name}</button> <span className="muted">{sub(p)}</span></span>
                  <span className="num">{fmt(values.get(p.id)?.val)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <div aria-live="polite">
        {r && e ? (
          <section className={`verdict tv ${VERDICT[e.verdict][0]}`}>
            <div className="tvhead">
              <h2>{VERDICT[e.verdict][1]}</h2>
              <b className="num tvnet">{signed(e.wins, Math.abs(e.wins) >= 1 ? 1 : 2)} wins</b>
            </div>
            {/* In expected wins: tradeCheck's close band is 0.15 either way. */}
            <TradeScale delta={e.wins} unit={0.15} digits={2} unitLabel=" wins" />
            <p className="tvwhy">{VERDICT[e.verdict][2]} {signed(e.deltaPtsPerWeek)} pts a week over {e.weeks} week{e.weeks === 1 ? '' : 's'} left, {signed(e.gainPts)} this week. Season value: give {fmt(r.giveVal)}, get {fmt(r.getVal)}.</p>
            {e.alsoDrop.length > 0 && <p>Makes room by dropping {e.alsoDrop.map(name).join(', ')}.</p>}
            {e.alsoAdd.length > 0 && <p>Fills the open spot{e.alsoAdd.length > 1 ? 's' : ''} with {e.alsoAdd.map(name).join(', ')}.</p>}
            {hurt.length > 0 && <p className="tvinj">Hurt: {hurt.map((p) => p.name).join(', ')}.</p>}
            <p className="muted">{e.assumes.filter((a) => !a.startsWith('Future weeks')).join(' ')}</p>
          </section>
        ) : r ? (
          <section className={`verdict tv ${VERDICT[r.verdict][0]}`}>
            <div className="tvhead">
              <h2>{VERDICT[r.verdict][1]}</h2>
              <b className="num tvnet">{signed(r.delta)}</b>
            </div>
            <TradeScale delta={r.delta} unit={r.unit} />
            <p className="tvwhy">{VERDICT[r.verdict][2]} Give {fmt(r.giveVal)}, get {fmt(r.getVal)}.</p>
            {r.spots > 0 && <p>Frees {r.spots} roster spot{r.spots > 1 ? 's' : ''}.</p>}
            {r.spots < 0 && <p>You must drop {-r.spots} to make room.</p>}
            {settings.format === 'cats' && (
              <div className="catdelta">
                {r.cats.map((c) => <span key={c.k} className={`tag ${c.delta > 0.3 ? 'good' : c.delta < -0.3 ? 'bad' : ''}`} title={c.name}>{c.label} {signed(c.delta)}</span>)}
              </div>
            )}
            {hurt.length > 0 && <p className="tvinj">Hurt: {hurt.map((p) => p.name).join(', ')}.</p>}
          </section>
        ) : (
          <p className="tvempty">{nextStep}</p>
        )}
      </div>

    </div>
  )
}
