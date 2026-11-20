// The pictures. Each one answers a question a table can only state: how likely, how far
// ahead, which nights, how sure. Plain SVG and CSS, no chart library, the same tokens as
// everything else. Rules they all keep (docs/design/PRINCIPLES.md):
//   - text wears text colours, never a series colour; a coloured mark sits beside it
//   - red and green never carry meaning alone: a filled/open shape or a word goes with them
//   - thin marks, hairline axes, a label only where the eye needs one
//   - every value is also on the page in words or in a table, so no tooltip gates anything
import React, { useLayoutEffect, useRef, useState } from 'react'
import { fmt } from './components.jsx'
import { dayName, weekDates } from './pages/today.js'
import './charts.css'

export { dayName, weekDates }
const sign = (x, d = 0) => { const r = +x.toFixed(d) || 0; return r > 0 ? `+${fmt(r, d)}` : r < 0 ? `−${fmt(-r, d)}` : '0' }
const pct = (x, lo, hi) => `${(100 * (x - lo)) / (hi - lo || 1)}%`

// SVG has to be drawn at its real width, or its 12px labels shrink to 9px on a phone.
function useWidth(fallback = 560) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    setW(el.clientWidth || fallback)
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width) || fallback))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// Round numbers for an axis: about `want` steps across the span.
function ticks(lo, hi, want = 5) {
  const raw = (hi - lo) / want
  const mag = 10 ** Math.floor(Math.log10(raw || 1))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6))
  return out
}

/**
 * A player's week, Monday to Sunday, one cell a night: filled = a game, open = none. Played
 * nights go grey, tonight gets an amber underline. The cells are the calendar; the number
 * beside the strip is what is left.
 */
export function WeekStrip({ team, teams, mon, today }) {
  const dates = weekDates(mon)
  const games = new Map((team?.games || []).filter((g) => g.d >= dates[0] && g.d <= dates[6]).map((g) => [g.d, g]))
  const left = [...games.keys()].filter((d) => d >= today).length
  const said = dates.filter((d) => games.has(d)).map((d) => dayName(d)).join(', ') || 'no games'
  return (
    <span className="wk" role="img" aria-label={`Games this week: ${said}. ${left} left.`}>
      {dates.map((d) => {
        const g = games.get(d)
        const opp = g ? `${g.home ? 'vs' : '@'} ${teams?.[g.opp]?.abbrev ?? '?'} ${new Date(g.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'no game'
        return <i key={d} title={`${dayName(d)} ${+d.slice(8)}: ${opp}`} className={`${g ? 'g' : ''}${d < today ? ' past' : ''}${d === today ? ' now' : ''}`} />
      })}
      <b>{left}</b>
    </span>
  )
}

// The header that sits over a column of strips: the day letters, in the same cells.
export function WeekHead({ mon, today }) {
  return (
    <span className="wk head" aria-hidden="true">
      {weekDates(mon).map((d) => <i key={d} className={d === today ? 'now' : ''}>{dayName(d)[0]}</i>)}
      <span className="wkspan">Mon–Sun</span>
      <b>left</b>
    </span>
  )
}

/**
 * Twenty equally likely endings of the week, as a quantile dotplot. Solid dots are the ones
 * you win, open dots the ones you lose, so the shape says it before the colour does. People
 * read "13 of 20" more accurately than "65%" or a bell curve (Kay et al., CHI 2016;
 * Fernandes et al., CHI 2018), which is the whole reason this exists.
 */
export function OutcomeDots({ q, oppName = 'He' }) {
  const [ref, w0] = useWidth()
  const w = Math.min(w0, 760)
  const n = q.length
  const wins = q.filter((x) => x > 0).length
  const pad = { l: 8, r: 8, t: 26, b: 50 }
  // Binned so the twenty stack into a shape. Bin edges sit on zero, so no column holds both
  // a win and a loss, and about nine bins cover the spread whatever its size.
  const span = Math.max(1, q[n - 1] - q[0])
  const bw = span / 9
  const bin = (v) => Math.floor(v / bw)
  const lo = Math.min(bin(q[0]), -1) * bw
  const hi = (Math.max(bin(q[n - 1]), 0) + 1) * bw
  const x = (v) => pad.l + ((v - lo) / (hi - lo)) * (w - pad.l - pad.r)
  const colPx = (bw / (hi - lo)) * (w - pad.l - pad.r)
  const r = Math.max(4, Math.min(9, colPx / 2 - 1))
  const step = 2 * r + 2
  const height = new Map()
  const dots = q.map((v) => {
    const b = bin(v)
    const k = height.get(b) ?? 0
    height.set(b, k + 1)
    return { v, cx: x((b + 0.5) * bw), k }
  })
  const rows = Math.max(...height.values())
  const base = pad.t + rows * step
  const h = base + pad.b
  const tk = ticks(lo, hi, Math.max(3, Math.floor(w / 110)))
  const mid = q[Math.floor(n / 2)]
  const words = (v) => (Math.abs(v) < 0.5 ? 'a dead heat' : v > 0 ? `you win by ${fmt(v, 0)}` : `${oppName} wins by ${fmt(-v, 0)}`)
  return (
    <figure className="chart dots" ref={ref}>
      <svg width={w} height={h} role="img" aria-label={`${n} equally likely final margins. You win ${wins} of them. The middle one: ${words(mid)}.`}>
        <line className="axis" x1={pad.l} x2={w - pad.r} y1={base + 4} y2={base + 4} />
        <line className="zero" x1={x(0)} x2={x(0)} y1={pad.t - 14} y2={base + 10} />
        <text className="zerolbl" x={x(0)} y={pad.t - 18} textAnchor="middle">even</text>
        {tk.map((t) => (
          <text key={t} x={x(t)} y={base + 22} textAnchor="middle">{sign(t)}</text>
        ))}
        {lo < 0 && <text className="side" x={pad.l} y={base + 42}>{'←'} {oppName} wins</text>}
        {hi > 0 && <text className="side" x={w - pad.r} y={base + 42} textAnchor="end">you win {'→'}</text>}
        {dots.map((d, i) => (
          <g key={i} className={d.v > 0 ? 'win' : 'loss'}>
            <title>{`Ending ${i + 1} of ${n}: ${words(d.v)}`}</title>
            <circle className="hit" cx={d.cx} cy={base - d.k * step - r} r={r + 4} />
            <circle className="dot" cx={d.cx} cy={base - d.k * step - r} r={d.v > 0 ? r : r - 1} />
          </g>
        ))}
      </svg>
      <figcaption className="legend">
        <b>You win {wins} of {n}</b>
        <span><span className="key win" /> you win</span>
        <span><span className="key loss" /> {oppName} wins</span>
        <span>Middle: {words(mid)}</span>
      </figcaption>
    </figure>
  )
}

/**
 * Where each side stands and where it is heading, on one scale: the solid bar is scored,
 * the wash is what is still to come, the whisker is the give-or-take on the final.
 */
export function RaceBars({ rows }) {
  const top = Math.max(1, ...rows.map((r) => r.mu + r.sd)) * 1.22
  const tk = ticks(0, top, 4).filter((t) => t < top)
  return (
    <figure className="chart race">
      {rows.map((r) => (
        <div key={r.name} className={`rrow ${r.tone}`}>
          <span className="rname">{r.name}</span>
          <div className="rtrack" role="img" aria-label={`${r.name}: ${fmt(r.now, 0)} scored, about ${fmt(r.mu, 0)} by Sunday, give or take ${fmt(r.sd, 0)}.`}>
            <i className="banked" style={{ width: pct(r.now, 0, top) }} title={`${fmt(r.now, 1)} scored`} />
            <i className="todo" style={{ left: pct(r.now, 0, top), width: pct(Math.max(0, r.mu - r.now), 0, top) }} title={`about ${fmt(r.mu - r.now, 0)} still to come`} />
            <i className="whisk" style={{ left: pct(Math.max(0, r.mu - r.sd), 0, top), width: pct(2 * r.sd, 0, top) }} title={`${fmt(r.mu - r.sd, 0)} to ${fmt(r.mu + r.sd, 0)}`} />
            <i className="mu" style={{ left: pct(r.mu, 0, top) }} />
            <span className="rval" style={{ left: `calc(${pct(r.mu + r.sd, 0, top)} + 8px)` }}>{Math.round(r.mu).toLocaleString()} <small>±{fmt(r.sd, 0)}</small></span>
          </div>
        </div>
      ))}
      <div className="raxis" aria-hidden="true">{tk.map((t) => <span key={t} style={{ left: pct(t, 0, top) }}>{t.toLocaleString()}</span>)}</div>
      <figcaption className="legend">
        <span><i className="sw solid" /> scored</span>
        <span><i className="sw wash" /> to come</span>
        <span><i className="sw whisk" /> likely range</span>
      </figcaption>
    </figure>
  )
}

/**
 * Players with a game each night against the slots that night. Above the line is games you
 * cannot use (washed out); a gap under it is slots that score nothing. One or two sides.
 */
export function NightBars({ dates, series, slots, today }) {
  const top = Math.max(slots + 1, ...series.flatMap((s) => s.values))
  const capAt = `${(100 * slots) / top}%`
  return (
    <figure className="chart nights">
      {series.length > 1 && (
        <figcaption className="legend">
          {series.map((s) => <span key={s.name}><i className={`sw ${s.tone}`} /> {s.name}</span>)}
          <span><i className="sw cap" /> {slots} slots</span>
        </figcaption>
      )}
      <div className="nplot" style={{ '--cap': capAt }}>
        <span className="caplbl">{slots} slots</span>
        {dates.map((d, i) => (
          <div key={d} className={`nday${d === today ? ' now' : ''}${d < today ? ' past' : ''}`}>
            <div className="ncols">
              {series.map((s) => {
                const v = s.values[i]
                const used = Math.min(v, slots)
                return (
                  <span key={s.name} className={`ncol ${s.tone}`} title={`${s.name}, ${dayName(d)}: ${v} with a game${v > slots ? `, ${v - slots} more than the slots` : ''}`}>
                    <i className="over" style={{ height: `${(100 * Math.max(0, v - slots)) / top}%`, bottom: `${(100 * used) / top}%` }} />
                    <i className="used" style={{ height: `${(100 * used) / top}%` }} />
                  </span>
                )
              })}
            </div>
            <span className="nlbl">{dayName(d)}</span>
            <span className="nval">{series.map((s) => s.values[i]).join(' · ')}</span>
          </div>
        ))}
      </div>
    </figure>
  )
}

/**
 * Horizontal bars for one measure across named rows: one colour, the value at the tip.
 * `hi` marks the one row the reader should land on; the rest stay grey.
 */
export function BarList({ rows, max, unit = '', hi }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="chart barlist">
      {rows.map((r) => (
        <li key={r.key ?? r.label} className={r.key === hi || r.label === hi ? 'hi' : ''}>
          <span className="blbl">{r.onClick ? <button className="link" onClick={r.onClick}>{r.label}</button> : r.label}{r.sub && <small>{r.sub}</small>}</span>
          <span className="btrack"><i style={{ width: pct(Math.max(0, r.value), 0, top) }} /></span>
          <span className="bval">{fmt(r.value, r.digits ?? 1)}{unit}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The trade on a scale: how far from even, and which side of "close" it lands. The middle
 * band is the app's own threshold for a clear difference, drawn rather than hidden. `delta`
 * and `unit` share one unit, named by `unitLabel` (" wins") and printed to `digits`.
 */
export function TradeScale({ delta, unit, unitLabel = '', digits = 1 }) {
  const ref = useRef(null)
  const R = Math.max(Math.abs(delta) * 1.3, unit * 3)
  const x = (v) => (v + R) / (2 * R)
  const at = (v) => pct(v, -R, R)
  const d = Math.abs(delta) >= 1 ? 1 : digits
  // A label shows only where it fits with 8px to spare: a lopsided trade leaves the band a few px wide.
  useLayoutEffect(() => {
    const fig = ref.current
    const fit = () => {
      for (const z of fig.querySelectorAll('.tzones span')) z.classList.toggle('mute', z.firstChild.offsetWidth + 8 > z.clientWidth)
      const half = fig.querySelector('.ttrack .band').offsetWidth / 2
      const [lo, mid] = fig.querySelectorAll('.tticks span')
      fig.classList.toggle('tight', (lo.offsetWidth + mid.offsetWidth) / 2 + 8 > half)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(fig)
    return () => ro.disconnect()
  }, [delta, unit, digits])
  // The value's label hangs off the marker toward the middle, so it never runs past the track.
  const side = x(delta) < 0.3 ? 'l' : x(delta) > 0.7 ? 'r' : ''
  return (
    <figure className="chart tscale" ref={ref}>
      <div className="tzones" aria-hidden="true">
        <span className="no" style={{ width: at(-unit) }}><em>Say no</em></span>
        <span className="close" style={{ width: `calc(${at(unit)} - ${at(-unit)})` }}><em>Close</em></span>
        <span className="yes"><em>Take it</em></span>
      </div>
      <div className="ttrack" role="img" aria-label={`Net ${sign(delta, d)}${unitLabel}. Anything inside ${fmt(unit, digits)}${unitLabel} either way is a close call.`}>
        <i className="zno" style={{ width: at(-unit) }} />
        <i className="band" style={{ left: at(-unit), width: `calc(${at(unit)} - ${at(-unit)})` }} />
        <i className="zyes" style={{ left: at(unit) }} />
        <i className="even" style={{ left: at(0) }} />
        <i className="mark" style={{ left: `clamp(2px, ${at(delta)}, calc(100% - 2px))` }} />
      </div>
      <div className="tticks" aria-hidden="true">
        <span className="edge" style={{ left: at(-unit) }}>{sign(-unit, digits)}</span>
        <span style={{ left: at(0) }}>even</span>
        <span className="edge" style={{ left: at(unit) }}>{sign(unit, digits)}</span>
        <b className={side} style={{ left: at(delta) }}>{sign(delta, d)}{unitLabel}</b>
      </div>
    </figure>
  )
}
