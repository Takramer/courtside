# Sources — what exists, what it costs, what I checked

Checked 2026-10-19 from this machine. "Verified" means I called it and read the response.

## Working today, already in the app

| Source | Key | Status | Gives |
|---|---|---|---|
| ESPN fantasy (`lm-api-reads.fantasy.espn.com`) | your cookies, private league | **Verified** — `api/players.js`, `api/league.js`, `api/matchup.js` | Player pool, projections, ADP, ownership, your league's rosters, free agents, live scoring |
| RotoWire RSS + ESPN headlines + ESPN injury report | none | **Verified** — `api/news.js` | Injury news, beat-writer notes |
| Google News RSS | none | **Verified** — `api/news.js?player=` | Per-player news, 14 days |

## The one that matters most, and the one with a problem

**`stats.nba.com` via [swar/nba_api](https://github.com/swar/nba_api)** — 141 endpoints, free,
no key, no signup. This is the only free source for the fine detail you asked about:

- `leagueseasonmatchups`, `matchupsrollup`, `boxscorematchupsv3` — defender vs scorer, by possession
- `playervsplayer`, `teamvsplayer`, `teamandplayersvsplayers` — career head-to-head
- `playbyplayv3` — technicals, flagrants, ejections, both players named (the friction table)
- `leaguedashptdefend`, `leaguedashptteamdefend` — defence by position
- `playerdashboardbylastngames`, `playerdashboardbygamesplits` — form, home/away, rest splits
- `leaguehustlestatsplayer`, `playerestimatedmetrics`, `winprobabilitypbp`

**Settled 2026-10-19: it works on your Mac.** NBA refuses the sandbox I work in — a 60-second
hang, and 403 from `cdn.nba.com` — so I expected the same everywhere. Wrong: run from your
MacBook, every endpoint the engine needs answers.

```
playergamelogs (2025-26)          6.0s   26,651 rows
commonallplayers                  1.5s      526 rows
leaguedashptteamdefend            1.7s       30 rows
leagueseasonmatchups (2025-26)   15.8s  147,805 rows   <- defender vs scorer, by possession
leaguedashplayerstats (2026-27)   0.6s        0 rows   <- correct: the season has not started
```

So the worker lives on the laptop, nightly. Assume Vercel and GitHub Actions are blocked like
the sandbox was. Two things the probe taught, both now in the worker: some endpoints hang on
one call and answer on the next, so retry with backoff and treat a hang as "later" rather than
"blocked"; and Python's own `ssl` module fails cert verification on this Mac while `requests`
is fine, because `requests` carries certifi. Use `requests`.

Fallbacks, if NBA ever locks the door: a residential proxy (costs money), or scraping
[Basketball-Reference](https://www.basketball-reference.com) (no API, strict terms, last resort).

## Free, keyless, verified reachable

| Source | Limit | Gives |
|---|---|---|
| [GDELT DOC API](https://api.gdeltproject.org/api/v2/doc/doc) | 1 request / 5 seconds, no key | Worldwide news by name with a tone score. The arrest/legal/personal feed. Returned a rate-limit notice when I hammered it, which is itself proof it is up and keyless. Coverage is media mentions, not verified facts — treat it as a lead, never a conclusion. |

## Worth a key, free tier

| Source | Free tier | Gives | Verdict |
|---|---|---|---|
| [The Odds API](https://the-odds-api.com) | ~500 credits/month (third-party figure — confirm on their site) | Game lines and totals. Vegas totals are the best single sanity check on a projection: if the model says a game runs hot and the market disagrees, the model is usually wrong. | **Get this key.** 500/month is plenty for one game slate a day. |
| [BALLDONTLIE](https://nba.balldontlie.io) | key, 5 req/min, teams + players + games only | Player game stats and injuries are paywalled at $9.99/mo | **Skip.** The free tier gives nothing we do not already have. |
| [Highlightly](https://highlightly.net) | 100 requests/day | Documented NBA stats with a key | Fallback if nba_api stays blocked. |

## Repos read, not depended on

- [swar/nba_api](https://github.com/swar/nba_api) — the dependency. Python.
- [cwendt94/espn-api](https://github.com/cwendt94/espn-api) — already the reference for every
  ESPN endpoint in `api/`. Keep using it that way.
- [JovaniPink/awesome-nba-data](https://github.com/JovaniPink/awesome-nba-data) — index of sources.
- [parlayparlor/nba-prop-prediction-model](https://github.com/parlayparlor/nba-prop-prediction-model)
  — nba_api + per-player projections, 32 stars. Closest working example of step 3.
- [norrisja/NBA-Monte-Carlo-Simulator](https://github.com/norrisja/NBA-Monte-Carlo-Simulator)
  — simulates real games, not fantasy weeks. Structure is borrowable, scoring is not.

I searched for a fantasy-basketball weekly-matchup simulator to start from. There is not a good
one. Every hit was either an abandoned personal repo with no stars or a categories-league
calculator, and yours is points. Phase 4 gets written from scratch.

## Keys to register for

1. **The Odds API** — free, one email. The only one I would get today.
2. Nothing else until nba_api is proven on your Mac. If it works, no further keys are needed
   for phases 1 through 8.
