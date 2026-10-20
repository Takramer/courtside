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
| `logs` | `courtside.db` | every player game log, both seasons |
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
