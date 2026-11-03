# Courtside

A fantasy basketball dashboard for the calls you make all season: who to start tonight, who to pick up, whether a trade is fair, and what the news means for your roster.

Live: https://courtside-rose.vercel.app

## Pages

| Page | What it does |
|---|---|
| Team | Shows your roster, flags its worst problem and offers the bench swap that fixes it |
| Matchup | Tracks this week's head-to-head live and projects the result |
| Waivers | Ranks free agents worth picking up |
| Trade | Compares both sides of a trade |
| League | Sets scoring rules and league size |
| Scorecard | Replays last season week by week to show how often the forecasts were right |
| News | Tags player news in plain English |

Data comes from free public ESPN, RotoWire and Google News feeds, so you don't need any API keys.

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
