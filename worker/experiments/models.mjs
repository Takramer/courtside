// Candidate projections. Each takes a player context from lib.mjs buildFrame (`c`, with his
// games before Monday in c.h, oldest first) and the week, and returns { mean, sd, pPlay, adj, pm }.
import { mean } from './lib.mjs'

const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5)
export const sigmoid = (x) => 1 / (1 + Math.exp(-x))

/** Weights over c.h: half as much every `hl` games back, and every `hlDays` days back. */
function weights(c, wk, hl = Infinity, hlDays = Infinity) {
  const n = c.h.length
  return c.h.map((r, i) => 0.5 ** ((n - 1 - i) / hl) * 0.5 ** (dayDiff(wk.monday, r.date) / hlDays))
}

/** Decayed mean of fantasy points, pulled towards `mu0` by `K` games' worth of weight. */
export function ewmaMean(c, wk, { hl, hlDays, K = 0, mu0 = 30 }) {
  const w = weights(c, wk, hl, hlDays)
  let sw = 0; let sx = 0
  c.h.forEach((r, i) => { sw += w[i]; sx += w[i] * r.fp })
  return (sx + K * mu0) / (sw + K)
}

/** Minutes first: a fast-moving minutes estimate times a slow-moving points-per-minute rate. */
export function minutesFirst(c, wk, { hlM, hlR, Kmin = 0, r0 = 1, K = 0, mu0 = 30 }) {
  const wm = weights(c, wk, hlM)
  const wr = weights(c, wk, hlR)
  let a = 0; let b = 0; let x = 0; let y = 0
  c.h.forEach((r, i) => { a += wm[i] * r.min; b += wm[i]; x += wr[i] * r.fp; y += wr[i] * r.min })
  const min = a / b
  const rate = (x + Kmin * r0) / (y + Kmin)
  const m = min * rate
  return K ? (m * b + K * mu0) / (b + K) : m
}

/** Chance he plays one game. `P` holds the fitted logistic weights; see 01-player.mjs. */
export function pPlayV2(c, g, wk, P) {
  const day = dayDiff(g.date, wk.monday)
  // League-wide drift: when healthy men have been sitting more than usual lately, expect more of it.
  const logit = (x) => Math.log(x / (1 - x))
  const drift = P.trail?.k && wk.availIdx ? P.trail.k * (logit(wk.availIdx) - logit(P.trail.ref)) : 0
  if (drift) return sigmoid(drift + (c.out ? P.out[0] + P.out[1] * day + P.out[2] * Math.log(c.gap) : P.ok[0] + P.ok[1] * (c.missed === 1) + P.ok[2] * (c.missed === 2) + P.ok[3] * (1 - c.form.avail) + P.ok[4] * day + P.ok[5] * (g.b2b ? 1 : 0)))
  if (c.out) return sigmoid(P.out[0] + P.out[1] * day + P.out[2] * Math.log(c.gap))
  return sigmoid(P.ok[0] + P.ok[1] * (c.missed === 1) + P.ok[2] * (c.missed === 2) + P.ok[3] * (1 - c.form.avail) + P.ok[4] * day + P.ok[5] * (g.b2b ? 1 : 0))
}

/** Rotation minutes his team is expected to be missing this week, from the same pPlay model. */
export function expectedMiss(c, wk, P) {
  let m = 0
  const g0 = { date: wk.monday, b2b: false }
  for (const t of wk.rosters.get(c.team) || []) {
    if (t.pid === c.pid) continue
    const q = pPlayV2({ out: t.out, gap: Math.max(1, t.gap), missed: t.missed, form: { avail: t.avail } }, { ...g0, date: wk.monday }, { monday: wk.monday }, P)
    m += t.em * (1 - q)
  }
  return m
}

/**
 * The v2 projection, switchable piece by piece so each change can be scored alone.
 *   on.mean     'base' | 'ewma' | 'min'
 *   on.play     fitted pPlay per game (missed-recently, horizon, back-to-back, returns from out)
 *   on.b2b      back-to-back multiplier on the points
 *   on.mate     teammate-out redistribution ('oracle' uses that night's real absences)
 *   on.shrink   regression to the pool mean;  on.ret  discount for men coming back
 *   on.sd       pooled spread
 *   on.dvp      keep the defence table (default true, as today)
 */
export function projectV2(P, on = {}) {
  return (c, wk) => {
    const baseAvg = c.base.mean
    let m = on.mean === 'ewma' ? ewmaMean(c, wk, P.ewma) : on.mean === 'min' ? minutesFirst(c, wk, P.min) : baseAvg
    if (on.shrink) m = P.shrink.mu0 + (m - P.shrink.mu0) * P.shrink.k
    // Back from a lay-off he plays less at first: one ratio per Monday status, from FIT.
    if (on.ret && c.out) m *= P.ret.out
    let sd = c.base.sd
    if (on.sd) sd = Math.sqrt(P.sd.w * c.base.sd ** 2 + (1 - P.sd.w) * (P.sd.a + P.sd.b * m) ** 2)
    const adj = c.slate.map((g, i) => (on.dvp === false ? 1 : c.dvp[i]) * (on.b2b && g.b2b ? P.b2b : 1))
    if (on.mate) {
      const usual = mean(c.h.slice(-25).map((r) => r.miss))
      const now = on.mate === 'oracle' ? null : expectedMiss(c, wk, P)
      const beta = on.mate === 'oracle' ? P.mateOracle : P.mate.beta
      for (let i = 0; i < adj.length; i++) adj[i] *= 1 + Math.max(-P.mate.cap, Math.min(P.mate.cap, beta * ((now ?? c.slate[i].miss) - usual)))
    }
    if (!on.play) return { mean: m, sd, pPlay: c.base.pPlay, adj }
    // pPlay 1 and the whole chance in pm, so each game carries its own number.
    // on.play 'out' or 'ok' switches on only that half of the model, to see which half does the work.
    const old = c.base.pPlay
    return { mean: m, sd, pPlay: 1, adj, pm: c.slate.map((g) => ((on.play === 'out' && !c.out) || (on.play === 'ok' && c.out) ? old : pPlayV2(c, g, wk, P))) }
  }
}

/** Logistic regression by Newton's method, with a whisper of ridge so a thin column cannot blow up. */
export function fitLogit(X, y, iters = 25) {
  const k = X[0].length
  const w = new Array(k).fill(0)
  for (let it = 0; it < iters; it++) {
    const g = new Array(k).fill(0)
    const H = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1e-3 : 0)))
    for (let n = 0; n < X.length; n++) {
      const x = X[n]
      const p = sigmoid(x.reduce((a, v, j) => a + v * w[j], 0))
      for (let i = 0; i < k; i++) { g[i] += (p - y[n]) * x[i]; for (let j = 0; j < k; j++) H[i][j] += p * (1 - p) * x[i] * x[j] }
    }
    // Solve H d = g by Gauss-Jordan; k is 3 or 6.
    const A = H.map((r, i) => [...r, g[i]])
    for (let i = 0; i < k; i++) {
      let piv = i
      for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r
      ;[A[i], A[piv]] = [A[piv], A[i]]
      for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c] }
    }
    for (let i = 0; i < k; i++) w[i] -= A[i][k] / A[i][i]
  }
  return w.map((x) => +x.toFixed(3))
}

/** The play model's two sets of weights, from the scheduled games of the given weeks. */
export function fitPlay(weeks, cut = 130) {
  const X = []; const y = []; const Xo = []; const yo = []
  for (const wk of weeks) for (const c of wk.top.slice(0, cut)) for (const g of c.slate) {
    const day = dayDiff(g.date, wk.monday)
    const did = c.actual.has(g.date) ? 1 : 0
    if (c.out) { Xo.push([1, day, Math.log(c.gap)]); yo.push(did) } else { X.push([1, c.missed === 1 ? 1 : 0, c.missed === 2 ? 1 : 0, 1 - c.form.avail, day, g.b2b ? 1 : 0]); y.push(did) }
  }
  return { ok: fitLogit(X, y), out: fitLogit(Xo, yo), n: [y.length, yo.length] }
}
