# Courtside — personal fantasy basketball dashboard

Vite + React front end, four Vercel functions in `api/`. No database, no accounts, no env vars: league settings and rosters live in the browser's localStorage (`cs.*` keys).

- `api/players.js` — ESPN fantasy public API: player pool, projections (`10<season>`), stat splits, ADP, ownership, team schedules. `SEASON = 2027` means the 2026-27 season; bump it each October.
- `api/news.js` — RotoWire RSS + ESPN headlines + ESPN injury report; `?player=Name` searches Google News RSS (last 14 days).
- `api/league.js`, `api/matchup.js` — the connected league: rosters, free agents, and this week's live head-to-head. Need the user's ESPN cookies, which never leave the browser.
- `src/lib/model.js` — all fantasy math (projection blend, z-scores, value over replacement, lineup matching, snake draft, trade check, news tags). Pure functions.
- `src/lib/predict.js` — the prediction engine: a projection per player, the week's win probability, the opponent adjustment, availability, and the matchup/friction lookups. Pure functions.
- `src/lib/grade.js` — phase 8: records each week's forecast before the games (`cs.ledger.v1`), settles it against ESPN's finals, and scores it. Brier against a 0.25 coin-flip baseline, plus bias and spread on the points projection. Pure functions.
- `worker/ingest.py` — runs on the Mac, not a server (NBA blocks datacenter IPs). Pulls game logs into `worker/courtside.db` (SQLite, gitignored) and writes `public/data/*.json`, which are committed and served as static files. `python ingest.py all` is the nightly job; `pbp` is separate and slow. See `docs/engine/PLAN.md`.

- `worker/backtest.mjs` — `npm run backtest`: replays last season week by week through predict.js and grade.js, reading `worker/courtside.db`, and writes `public/data/backtest.json`. The Scorecard shows it and the live odds use its spread correction. Re-run it after any change to predict.js.

Verify: `npm run check` (asserts on model.js, predict.js, grade.js and the replay) and `npm run build`. `npm run dev` serves `/api` through a Vite middleware, no Vercel CLI needed. The check covers the math only; it does not prove the UI works.
