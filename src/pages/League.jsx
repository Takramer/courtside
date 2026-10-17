import React from 'react'
import { CATS, DEFAULT_SETTINGS, DEFAULT_WEIGHTS } from '../lib/model.js'

const WEIGHT_LABELS = { pts: 'Point', tpm: '3-pointer made', fgm: 'Field goal made', fga: 'Field goal attempted', ftm: 'Free throw made', fta: 'Free throw attempted', reb: 'Rebound', ast: 'Assist', stl: 'Steal', blk: 'Block', to: 'Turnover' }

export default function League({ ctx }) {
  const s = ctx.settings
  const set = (k, v) => ctx.setSettings({ ...s, [k]: v })
  const num = (k, min, max) => <input type="number" min={min} max={max} value={s[k]} onChange={(e) => set(k, Math.max(min, Math.min(max, +e.target.value || min)))} />

  return (
    <div className="page narrow">
      <h1>League setup</h1>
      <p className="lead">Copy these from your league's settings page (in the ESPN, Yahoo or Sleeper app: League → Settings). Everything saves in this browser.</p>

      <section className="form">
        <label>Scoring type
          <div className="seg">
            <button className={s.format === 'cats' ? 'on' : ''} onClick={() => set('format', 'cats')}>Categories (H2H or roto)</button>
            <button className={s.format === 'points' ? 'on' : ''} onClick={() => set('format', 'points')}>Points</button>
          </div>
          <small>If your settings list "Scoring: H2H Each Category", "H2H Most Categories" or "Roto", pick Categories. If they list points per stat, pick Points.</small>
        </label>
        <label>Number of teams {num('teams', 4, 20)}</label>
        <label>Roster size (starters + bench, not counting injured-reserve spots) {num('rosterSize', 5, 20)}</label>
        <label>Your draft position (1 = first pick) {num('draftSlot', 1, s.teams)}</label>
        <label>Starting slots, comma separated
          <input value={s.slots} onChange={(e) => set('slots', e.target.value.toUpperCase().replace(/[^A-Z,]/g, ''))} />
          <small>ESPN default: PG,SG,SF,PF,C,G,F,UT,UT,UT. G = any guard, F = any forward, UT = anyone.</small>
        </label>

        {s.format === 'cats' ? (
          <label>Categories that count
            <div className="checks">
              {CATS.map((c) => (
                <label key={c.k}><input type="checkbox" checked={!s.punt.includes(c.k)}
                  onChange={(e) => set('punt', e.target.checked ? s.punt.filter((x) => x !== c.k) : [...s.punt, c.k])} /> {c.label}</label>
              ))}
            </div>
            <small>Untick a category your league does not use (8-cat leagues drop TO), or one you choose to give up on ("punt"). Rankings update instantly.</small>
          </label>
        ) : (
          <label>Points per stat
            <div className="weights">
              {Object.keys(DEFAULT_WEIGHTS).map((k) => (
                <label key={k}>{WEIGHT_LABELS[k]}<input type="number" step="0.5" value={s.weights[k] ?? 0} onChange={(e) => set('weights', { ...s.weights, [k]: +e.target.value })} /></label>
              ))}
            </div>
            <small>Defaults match Grace One Charlotte FBL: ESPN points scoring, except a made free throw nets +1 and a miss −1.</small>
          </label>
        )}

        <label>Waiver guess: hide players owned in more than this % of ESPN leagues {num('ownCutoff', 10, 100)}
          <small>Only used until you mark the whole draft in Draft. Lower it for small leagues, raise it for big ones.</small>
        </label>
      </section>

      <button className="btn ghost" onClick={() => ctx.setSettings(DEFAULT_SETTINGS)}>Reset to defaults</button>
    </div>
  )
}
