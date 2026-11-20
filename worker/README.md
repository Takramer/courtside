# Worker

Pulls NBA game logs into `courtside.db` (SQLite, gitignored) and writes the small derived
files the website reads from `../public/data/`. No database, no Supabase.

The website never calls these sources. It fetches the JSON off the CDN. If the worker is
broken or your laptop is shut, Courtside still works on ESPN data — just with staler numbers,
and with no defence table it prices every night at face value.

## Running it

```bash
cd worker && . .venv/bin/activate && python ingest.py all
```

`all` is logs, then form, then export, then dvp. Seconds, once the logs are in. The pieces
run on their own too:

| Job | Writes | What it is |
|---|---|---|
| `logs` | `courtside.db` | every player game log, both seasons; ESPN box scores when NBA hangs |
| `form` | nothing | mean, spread and availability per player, printed |
| `export` | `../public/data/form.json` | the same, for the site |
| `dvp` | `../public/data/dvp.json` | fantasy points per 36 allowed, by team and position |
| `matchups` | `../public/data/matchups.json` | defender vs scorer, possession by possession |
| `friction` | `../public/data/friction.json` | flagrants and double technicals, both men named |
| `pbp` | `courtside.db` | play-by-play, the input to `friction`. Not in `all` — see below |

`pbp` is the one slow job: one call per game, about twenty minutes for a full season. It
stores as it goes and remembers which games it has read, so it is safe to interrupt and
cheap to re-run — after a night of basketball it only fetches the new games. Run it on its
own, then `friction` to rebuild the table from what it collected:

```bash
python ingest.py pbp && python ingest.py friction
```

`npm run backtest`, from the repo root, replays last season through the site's own engine
and writes `../public/data/backtest.json` for the Scorecard. It reads `courtside.db`, so run
`logs` first. About a second. Run it again after any change to `src/lib/predict.js`.

### When stats.nba.com does not answer

`logs` gives `playergamelogs` one try with a 15-second timeout. If it hangs, this season
comes from ESPN's public box scores instead: one `scoreboard?dates=YYYYMMDD` call per date
from opening night (2026-10-20), then one `summary?event=<id>` per finished game. No key, no
cookies. Calls go one at a time with a short pause, and every final box score is cached in
the `espn_cache` table of `courtside.db`, so a re-run only fetches new nights. The first
back-fill (222 games) took three minutes; a nightly run is a few seconds.

ESPN rows go into the same `player_games` table. A player is joined to his NBA id by
normalised name; a man the db has never seen (a rookie, or a veteran who sat out last
season) is stored under his ESPN athlete id, negated. ESPN game ids do not start with `00`,
and a later successful NBA pull replaces them. Last season stays as stored.

Checked 2026-11-19: one 2025-26 game read both ways gave the same fantasy points for every
player (508 = 508) and minutes within rounding (481 against 480).

Because ESPN hosts are allowed in the `courtside` cloud environment and NBA's are not, the
twice-daily cloud session can now run `python3 ingest.py logs && python3 ingest.py export`
itself and keep `form.json` fresh without the Mac. `courtside.db` is gitignored, so a cloud
run starts empty: it back-fills the season (about three minutes, `pip install requests`
first if the image lacks it) and stores everyone under ESPN ids, which `form.json` does not
care about. Not yet tried from the cloud.

`python ingest.py --selfcheck` runs the asserts on the pure parts (minutes-first projection,
the teammate-minutes walk, missed games), no network.

`python ingest.py --check` answers one question: can this machine reach `stats.nba.com`? NBA
blocks most datacenter IPs; a residential connection is fine.

Both JSON files are committed, so new numbers reach the site by deploy rather than instantly.
That is the trade for having no database, and for a nightly job it is not much of one.

## Where it will run

launchd on your Mac, nightly, after the last game. Not Vercel — serverless functions are
datacenter IPs and almost certainly blocked, on top of the 10-second limit. Not GitHub
Actions, same IP problem. If the Mac turns out to be too unreliable a host, the fallback is a
residential proxy, which costs money and is the only part of this plan that does.

## Secrets

`worker/.env`, never committed, never read by me:

```
ODDS_API_KEY=             # optional, unused: game lines, as a sanity check on a projection
```

Nothing the worker does today needs a key. `stats.nba.com` wants none.

No ESPN cookies here. The worker has no business touching your ESPN account — the browser
already does that, with credentials that stay on your devices.
