// Diagnostics only: where does the baseline miss? Prints tables for FIT weeks (and TEST for
// reference; nothing is chosen from TEST).   node --no-warnings worker/experiments/explore.mjs
import { load, buildFrame, mean } from './lib.mjs'
const frame = buildFrame(load(process.argv[2] || '2025-26'))
const tab = (name, keyFn, valFn, { test = false } = {}) => {
  const b = new Map()
  for (const wk of frame.weeks) {
    if (frame.isFit(wk.w) === test) continue
    for (const c of wk.top.slice(0, 130)) c.slate.forEach((g, i) => {
      const k = keyFn(c, g, i, wk); if (k == null) return
      const v = valFn(c, g, i); if (v == null) return
      if (!b.has(k)) b.set(k, []); b.get(k).push(v)
    })
  }
  console.log(`${name} [${test ? 'TEST' : 'FIT'}]: ` + [...b].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([k, v]) => `${k}=${mean(v).toFixed(3)}(${v.length})`).join('  '))
}
const played = (c, g) => (c.out ? null : c.actual.has(g.date) ? 1 : 0)
const ratio = (c, g) => { const r = c.actual.get(g.date); return r ? r.fp / c.base.mean : null }
const minRatio = (c, g) => { const r = c.actual.get(g.date); const m = mean(c.h.slice(-25).map((x) => x.min)); return r ? r.min / m : null }
for (const test of [false, true]) {
  tab('play | missed of last 3', (c) => c.missed, played, { test })
  tab('play | season avail', (c) => (c.form.avail >= 0.95 ? 'a95+' : c.form.avail >= 0.85 ? 'a85' : c.form.avail >= 0.7 ? 'a70' : 'a<70'), played, { test })
  tab('play | b2b', (c, g) => (c.missed ? null : g.b2b ? 'b2b' : 'rest'), played, { test })
  tab('play | day of week', (c, g, i, wk) => (c.missed ? null : Math.round((Date.parse(g.date) - Date.parse(wk.monday)) / 864e5)), played, { test })
  tab('play | week', (c, g, i, wk) => (c.missed ? null : String(wk.w).padStart(2, '0')), played, { test })
  tab('play OUT-flagged', (c) => (c.out ? 'out' : null), (c, g) => (c.actual.has(g.date) ? 1 : 0), { test })
  tab('fp ratio | b2b', (c, g) => (g.b2b ? 'b2b' : 'rest'), ratio, { test })
  tab('fp ratio | home', (c, g) => (g.home ? 'home' : 'away'), ratio, { test })
  tab('fp ratio | |exp margin|', (c, g) => (Math.abs(g.exp) < 4 ? 'm0-4' : Math.abs(g.exp) < 8 ? 'm4-8' : Math.abs(g.exp) < 12 ? 'm8-12' : 'm12+'), ratio, { test })
  tab('min ratio | |exp margin|', (c, g) => (Math.abs(g.exp) < 4 ? 'm0-4' : Math.abs(g.exp) < 8 ? 'm4-8' : Math.abs(g.exp) < 12 ? 'm8-12' : 'm12+'), minRatio, { test })
  tab('fp ratio | fav/dog 8+', (c, g) => (g.exp >= 8 ? 'fav' : g.exp <= -8 ? 'dog' : 'mid'), ratio, { test })
  tab('fp ratio | base mean', (c) => (c.base.mean >= 45 ? 'm45+' : c.base.mean >= 35 ? 'm35' : c.base.mean >= 28 ? 'm28' : 'm<28'), ratio, { test })
  tab('fp ratio | hot (L5 vs L25)', (c) => { const l5 = mean(c.h.slice(-5).map((x) => x.fp)); const d = l5 / c.base.mean; return d > 1.15 ? 'hot' : d < 0.85 ? 'cold' : 'flat' }, ratio, { test })
  tab('fp ratio | L25 vs season', (c) => { if (c.h.length < 35) return null; const d = c.base.mean / mean(c.h.map((x) => x.fp)); return d > 1.08 ? 'above' : d < 0.92 ? 'below' : 'same' }, ratio, { test })
  tab('fp ratio | teamOutMin now - avg miss', (c) => { const d = c.teamOutMin - mean(c.h.slice(-25).map((x) => x.miss)); return d > 25 ? 'd+25' : d > 8 ? 'd+8' : d < -25 ? 'd-25' : d < -8 ? 'd-8' : 'd0' }, ratio, { test })
  tab('fp ratio | week', (c, g, i, wk) => String(wk.w).padStart(2, '0'), ratio, { test })
  tab('fp ratio | games in form', (c) => (c.h.length < 10 ? 'g<10' : c.h.length < 25 ? 'g<25' : 'g25+'), ratio, { test })
  console.log()
}
