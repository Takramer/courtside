# Courtside — personal fantasy basketball dashboard

Vite + React front end, two Vercel functions in `api/`. No database, no accounts, no env vars: league settings and rosters live in the browser's localStorage (`cs.*` keys).

- `api/players.js` — ESPN fantasy public API: player pool, projections (`10<season>`), stat splits, ADP, ownership, team schedules. `SEASON = 2027` means the 2026-27 season; bump it each October.
- `api/news.js` — RotoWire RSS + ESPN headlines + ESPN injury report; `?player=Name` searches Google News RSS (last 14 days).
- `src/lib/model.js` — all fantasy math (projection blend, z-scores, value over replacement, lineup matching, snake draft, trade check, news tags). Pure functions.

Verify: `npm run check` (asserts on model.js) and `npm run build`. `npm run dev` serves `/api` through a Vite middleware, no Vercel CLI needed. The check covers the math only; it does not prove the UI works.
