# Worker — skeleton

Pulls NBA data into Supabase on a schedule. Nothing is wired yet: `ingest.py` lists the plan
and refuses to run.

The website never calls these sources. It reads Supabase. If the worker is broken or your
laptop is shut, Courtside still works on ESPN data — just with staler numbers.

## First thing to settle

`stats.nba.com` blocks datacenter IPs. It hung for 60 seconds from the sandbox I work in, and
`cdn.nba.com` answered 403. Your MacBook is a residential IP, so it should be fine, but that is
a guess until you run it:

```bash
cd worker && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && python ingest.py --check
```

Prints OK and a row count, or prints what blocked it. Everything in phases 2 and up depends on
that one answer, so run it before I build any of it.

## Where it will run

launchd on your Mac, nightly, after the last game. Not Vercel — serverless functions are
datacenter IPs and almost certainly blocked, on top of the 10-second limit. Not GitHub
Actions, same IP problem. If the Mac turns out to be too unreliable a host, the fallback is a
residential proxy, which costs money and is the only part of this plan that does.

## Secrets

`worker/.env`, never committed, never read by me:

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=     # service key: this is the only thing that writes the warehouse
ODDS_API_KEY=             # optional, phase 5
```

No ESPN cookies here. The worker has no business touching your ESPN account — the browser
already does that, with credentials that stay on your devices.
