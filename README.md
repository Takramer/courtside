# Courtside

Personal fantasy basketball dashboard. One page for the decisions that come up in a season: who to start tonight, who to pick up, whether a trade is fair, and what the news means.

Live: https://courtside-rose.vercel.app

## Pages

- **Team** — your roster, the biggest problem on it, and the swap that fixes it.
- **Matchup** — this week's head-to-head, live, with a projected result.
- **Waivers** — free agents worth a pickup.
- **Trade** — compares both sides of a trade.
- **League** — league setup: scoring rules and league size.
- **Scorecard** — how well the model's forecasts held up, replayed over last season.
- **News** — player news tagged in plain English.

Data comes from free public ESPN, RotoWire and Google News feeds. No API keys needed.

## Run it

```sh
npm install
npm run dev       # http://localhost:5173
npm run check     # model self-check
npm run backtest  # backtest the model (needs worker data)
```

## Layout

| Path | What it holds |
|---|---|
| `src/` | React app (pages, components, scoring model in `src/lib/`) |
| `api/` | Vercel serverless functions that fetch league, player, matchup and news data |
| `worker/` | Optional Python ingest of NBA game logs into the JSON files under `public/data/` (see `worker/README.md`) |
| `docs/` | Design and engine notes |

Stack: React 18, Vite, Vercel.

## License

MIT. See [LICENSE](LICENSE).
