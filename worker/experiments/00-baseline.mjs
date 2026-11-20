// Does the harness reproduce `npm run backtest`? It must, to four places, or nothing built
// on it means anything.   node --no-warnings worker/experiments/00-baseline.mjs
import assert from 'node:assert/strict'
import { load, buildFrame, price, split, row, playerScore } from './lib.mjs'

const t0 = Date.now()
const frame = buildFrame(load(process.argv[2] || '2025-26'))
const s = split(frame, price(frame))
console.log(row('all 22 weeks', s.all)); console.log(row('fit  (first 11)', s.fit)); console.log(row('test (last 11)', s.test))
console.log('deciles, test:', s.test.deciles.map((d) => `${d.bin}:${d.said}/${d.won}(${d.n})`).join(' '))
console.log('players fit ', JSON.stringify(playerScore(frame, undefined, { test: false })))
console.log('players test', JSON.stringify(playerScore(frame, undefined, { test: true })))
if (!process.argv[2]) { assert.equal(s.all.brier, 0.1846); assert.equal(s.all.bias, -38.6); assert.equal(s.all.mae, 142.8) }
console.log(`ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
