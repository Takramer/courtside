import React, { useEffect, useState } from 'react'
import { linkFor, newCode, pack } from '../lib/link.js'
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

      <EspnLink ctx={ctx} />

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

// Reads the real league from ESPN: every roster, and ESPN's own list of who is free.
function EspnLink({ ctx }) {
  const { espn, setEspn, league, linked } = ctx
  const [form, setForm] = useState({ league: espn.league, s2: espn.s2 || '', swid: espn.swid || '' })
  const [open, setOpen] = useState(false)
  const on = !!espn.league

  const connect = (e) => {
    e.preventDefault()
    const id = form.league.replace(/\D/g, '')
    if (!id) return ctx.toast('Paste the leagueId number from your ESPN league URL.')
    setEspn({ league: id, s2: form.s2.trim(), swid: form.swid.trim(), team: null })
    setOpen(false)
  }
  const stop = () => { setEspn({ league: '', s2: '', swid: '', team: null }); setOpen(false) }

  if (!on) {
    return (
      <section className="lsec espnlink">
        <h2>Read my league from ESPN</h2>
        {!open ? (
          <>
            <p>Right now the app guesses who is free from how many ESPN leagues own a player. Connect your league and it reads the real thing: all ten rosters, and ESPN's own free agent list.</p>
            <button className="btn" onClick={() => setOpen(true)}>Connect my league</button>
          </>
        ) : (
          <form className="espnform" onSubmit={connect}>
            <label>League id
              <input autoFocus value={form.league} onChange={(e) => setForm({ ...form, league: e.target.value })} placeholder="e.g. 2028559007" inputMode="numeric" />
              <small>The number after <code>leagueId=</code> in your ESPN league's address bar.</small>
            </label>
            <label>espn_s2
              <input type="password" value={form.s2} onChange={(e) => setForm({ ...form, s2: e.target.value })} autoComplete="off" />
            </label>
            <label>SWID
              <input type="password" value={form.swid} onChange={(e) => setForm({ ...form, swid: e.target.value })} autoComplete="off" placeholder="{....}" />
            </label>
            <small>A private league needs both cookies. In your browser on fantasy.espn.com: DevTools → Application → Cookies. They stay in this browser and are sent to ESPN only.</small>
            <div className="row">
              <button className="btn" type="submit">Connect</button>
              <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        )}
      </section>
    )
  }

  return (
    <section className="lsec espnlink">
      <h2>{league.name || 'Your ESPN league'}</h2>
      {league.error && <p className="banner bad">{league.error}</p>}
      {league.teams.length > 0 && (
        <label className="field row">
          <span className="lname">Which team is yours</span>
          <select value={espn.team ?? ''} onChange={(e) => setEspn({ ...espn, team: +e.target.value })}>
            <option value="" disabled>Pick your team</option>
            {league.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}
      <p className="muted">
        {league.loading ? 'Reading ESPN…'
          : linked ? `All ${league.teams.length} rosters read ${new Date(league.at).toLocaleTimeString()}. My team and Waivers now follow ESPN, so add or drop there and reload this page.`
          : league.at ? 'Pick your team above and the rosters load.'
          : 'Not read yet.'}
      </p>
      <div className="row">
        <button className="btn ghost" onClick={league.reload} disabled={league.loading}>Read again</button>
        <button className="btn ghost" onClick={stop}>Disconnect</button>
      </div>
      <PhoneLink ctx={ctx} />
    </section>
  )
}

// Your phone cannot read a cookie — iOS Safari has no DevTools. So carry the connection over
// in a link, encrypted with six digits that travel separately from the link itself.
function PhoneLink({ ctx }) {
  const { espn } = ctx
  const [made, setMade] = useState(null)
  const [busy, setBusy] = useState(false)

  const make = async () => {
    setBusy(true)
    try {
      const code = newCode()
      const token = await pack({ league: espn.league, team: espn.team, s2: espn.s2 || '', swid: espn.swid || '' }, code)
      setMade({ code, url: linkFor(token) })
    } catch (e) {
      ctx.toast(`Could not build the link: ${e.message}`)
    }
    setBusy(false)
  }

  if (!made) {
    return (
      <div className="phonelink">
        <button className="btn ghost sm" onClick={make} disabled={busy || !espn.team}>Set up my phone</button>
        <small>{espn.team ? 'Makes a one-time link that carries this connection to another device.' : 'Pick your team first.'}</small>
      </div>
    )
  }

  return (
    <div className="phonelink made">
      <ol>
        <li>Send this link to your phone — AirDrop, Messages, however. <button className="btn ghost sm" onClick={() => { navigator.clipboard.writeText(made.url); ctx.toast('Link copied') }}>Copy link</button></li>
        <li>Open it there. It will ask for a code.</li>
        <li>Type <b className="code">{made.code}</b>. Do not send the code in the same message as the link.</li>
      </ol>
      <small>The link carries your connection encrypted; the code is the only thing that opens it, and it is not in the link. Nothing is stored on any server — the encrypted part lives after the <code>#</code>, which browsers never send. The link stops being useful once you have used it; make another any time.</small>
      <button className="btn ghost sm" onClick={() => setMade(null)}>Done</button>
    </div>
  )
}
