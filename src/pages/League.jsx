import React, { useEffect, useState } from 'react'
import { CATS, DEFAULT_SETTINGS, DEFAULT_WEIGHTS } from '../lib/model.js'
import './extras.css'

const WEIGHT_LABELS = { pts: 'Point', tpm: '3-pointer made', fgm: 'Field goal made', fga: 'Field goal attempted', ftm: 'Free throw made', fta: 'Free throw attempted', reb: 'Rebound', ast: 'Assist', stl: 'Steal', blk: 'Block', to: 'Turnover' }

// Keeps what you type until it is a valid number, so typing "12" is not clamped to 4 after the "1". Clamps on blur.
function NumField({ value, min, max, onCommit, step }) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  const ok = (n) => Number.isFinite(n) && n >= min && n <= max
  return (
    <input type="number" inputMode={step ? 'decimal' : 'numeric'} min={min} max={max} step={step} value={text}
      onChange={(e) => { setText(e.target.value); const n = +e.target.value; if (e.target.value !== '' && ok(n) && n !== value) onCommit(n) }}
      onBlur={() => { const n = Math.max(min, Math.min(max, Math.round(+text) || min)); setText(String(n)); if (n !== value) onCommit(n) }} />
  )
}

const Affects = ({ children }) => <p className="affects"><span>Changes</span> {children}</p>

export default function League({ ctx }) {
  const s = ctx.settings
  const set = (k, v) => {
    ctx.setSettings({ ...s, [k]: v })
    ctx.toast('Saved. Rankings updated.', { id: 'league-saved', duration: 1600 })
  }
  const num = (k, min, max) => <NumField value={s[k]} min={min} max={max} onCommit={(v) => set(k, v)} />
  const isDefault = JSON.stringify(s) === JSON.stringify(DEFAULT_SETTINGS)
  const reset = () => {
    const prev = s
    ctx.setSettings(DEFAULT_SETTINGS)
    ctx.toast('Reset to defaults', { id: 'league-saved', action: { label: 'Undo', onClick: () => ctx.setSettings(prev) } })
  }

  return (
    <div className="page narrow leaguepage">
      <h1>League setup</h1>
      <p className="lead">Copy these from your league's settings page (in the ESPN, Yahoo or Sleeper app: League → Settings). Everything saves in this browser as you type.</p>

      <section className="lsec" aria-labelledby="ls-scoring">
        <h2 id="ls-scoring">Scoring</h2>
        <div className="field">
          <span className="lname" id="ls-format">Scoring type</span>
          <div className="seg" role="group" aria-labelledby="ls-format">
            <button className={s.format === 'cats' ? 'on' : ''} aria-pressed={s.format === 'cats'} onClick={() => set('format', 'cats')}>Categories (H2H or roto)</button>
            <button className={s.format === 'points' ? 'on' : ''} aria-pressed={s.format === 'points'} onClick={() => set('format', 'points')}>Points</button>
          </div>
          <small>If your settings list "Scoring: H2H Each Category", "H2H Most Categories" or "Roto", pick Categories. If they list points per stat, pick Points.</small>
          <Affects>every ranking, value and suggestion in the app.</Affects>
        </div>

        {s.format === 'cats' ? (
          <fieldset className="field">
            <legend className="lname">Categories that count</legend>
            <div className="checks">
              {CATS.map((c) => (
                <label key={c.k}><input type="checkbox" checked={!s.punt.includes(c.k)}
                  onChange={(e) => set('punt', e.target.checked ? s.punt.filter((x) => x !== c.k) : [...s.punt, c.k])} /> {c.label}</label>
              ))}
            </div>
            <small>Untick a category your league does not use (8-cat leagues drop TO), or one you choose to give up on ("punt").</small>
            <Affects>player values. Unticked categories stop counting for or against anyone.</Affects>
          </fieldset>
        ) : (
          <fieldset className="field">
            <legend className="lname">Points per stat</legend>
            <div className="weights">
              {Object.keys(DEFAULT_WEIGHTS).map((k) => (
                <label key={k}>{WEIGHT_LABELS[k]}<input type="number" step="0.5" value={s.weights[k] ?? 0} onChange={(e) => set('weights', { ...s.weights, [k]: +e.target.value })} /></label>
              ))}
            </div>
            <small>Defaults match Grace One Charlotte FBL: ESPN points scoring, except a made free throw nets +1 and a miss −1.</small>
            <Affects>each player's fantasy points per game, and so every ranking.</Affects>
          </fieldset>
        )}
      </section>

      <section className="lsec" aria-labelledby="ls-size">
        <h2 id="ls-size">League size</h2>
        <label className="field row">
          <span className="lname">Number of teams</span>{num('teams', 4, 20)}
          <Affects>how many players count as worth owning, so who looks replaceable.</Affects>
        </label>
        <label className="field row">
          <span className="lname">Roster size <small>starters + bench, not injured-reserve spots</small></span>{num('rosterSize', 5, 20)}
          <Affects>how many open spots you have, and who looks replaceable.</Affects>
        </label>
      </section>

      <section className="lsec" aria-labelledby="ls-lineup">
        <h2 id="ls-lineup">Lineup</h2>
        <label className="field">
          <span className="lname">Starting slots, comma separated</span>
          <input className="slots" value={s.slots} onChange={(e) => set('slots', e.target.value.toUpperCase().replace(/[^A-Z,/]/g, ''))} />
          <small>Your league: PG,SG,SF,PF,C,G,F,PF/C,UT,UT. G = any guard, F = any forward, PF/C = power forward or centre, UT = anyone.</small>
          <Affects>the starting lineup shown on My team.</Affects>
        </label>
      </section>

      <section className="lsec" aria-labelledby="ls-waivers">
        <h2 id="ls-waivers">Waivers</h2>
        <label className="field row">
          <span className="lname">Hide players owned in more than this % of ESPN leagues</span>{num('ownCutoff', 10, 100)}
          <small>A rough stand-in for who is actually free in your league. Lower it for small leagues, raise it for big ones.</small>
          <Affects>who shows up on Waivers.</Affects>
        </label>
      </section>

      <div className="lfoot">
        <button className="btn ghost" onClick={reset} disabled={isDefault}>Reset to defaults</button>
        <small>{isDefault ? 'You are on the default settings.' : 'Puts every setting back to Grace One Charlotte FBL. You can undo it.'}</small>
      </div>
    </div>
  )
}
