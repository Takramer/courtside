# Courtside engine — plan

Skeleton only. Nothing here is built yet. Written 2026-10-19.

Two jobs, in this order:

1. **Make the app remember.** Today everything lives in one browser's localStorage, so your
   phone and your MacBook are two different apps. Move the state to Supabase.
2. **Build the engine.** A warehouse of NBA history and news, a projection per player per
   game, and a simulation that answers one question every week: what are my odds, and why.

---

## 1. Persistence

### What actually needs to sync

| Thing | Where it lives now | Move to Supabase? |
|---|---|---|
| League settings (`cs.settings.v3`) | localStorage | Yes |
| Roster, taken players | localStorage, overwritten by ESPN | No — ESPN is the record once connected |
| ESPN league id, your team id | localStorage | Yes |
| **espn_s2 / SWID cookies** | localStorage | **No. See below.** |
| Notes you write on players (not built) | — | Yes |

The cookies are the one thing I would keep on each device. They are live credentials to your
ESPN account, not just the fantasy league: anything that can read your league can read your
account. Putting them in a database means a database leak is an account leak. Pasting them
twice — once per device — costs you two minutes a season. If you decide you want them synced
anyway, they get their own encrypted column with a key that never leaves your devices, and I
will say plainly that it is a worse trade.

### Identity — decided 2026-10-19: magic link

Supabase Auth, email link, no password. You sign in once per device and stay signed in; the
session refreshes itself. `app_state` keys on `auth.uid()`, so row-level security is the one
line Supabase writes for you rather than something hand-rolled around a shared secret. It
costs a sign-in screen on first load, and it means a lost phone is handled by signing out that
session rather than by rotating a code on every device.

Rejected: a shared sync code. Simpler to build, but unrecoverable and awkward to revoke.

### Cost

A third Supabase project in your org prices at **$0/month** (I asked the API, not a blog).
It stays separate from nydex and underline, which both have real users and Stripe keys — the
fantasy dashboard has no business sharing a database with either.

---

## 2. The engine

### Shape

```
  nba_api / ESPN / GDELT / odds          Supabase                  the website
  ───────────────────────────────        ─────────                 ───────────
  worker (Python, scheduled)   ──────▶   warehouse tables  ──────▶  reads only
  pulls, normalises, scores              + your app state           never calls the
                                                                    slow sources itself
```

The website never waits on a slow source. The worker fills Supabase on a schedule; the pages
read rows. If the worker dies, the site keeps working on ESPN data, just with staler numbers.

**Where the worker runs is an open question.** `stats.nba.com` refuses datacenter IPs — from
this sandbox it hangs for 60 seconds and `cdn.nba.com` answers 403. It very likely refuses
Vercel and GitHub Actions too. The reliable home for the worker is your MacBook on a timer,
which also means the engine only refreshes when your laptop is awake. See SOURCES.md.

### The model

Everything serves one number: **P(I win this week)**.

**Step 1 — minutes.** Points follow minutes. A player's minutes are a function of his role,
who else is hurt, blowout risk, and whether he is on a back-to-back. Model minutes first,
fantasy points second, and most of the "why" falls out for free.

**Step 2 — a distribution per player per game**, not a single number:

- `mean_fp` — blended: ESPN projection, his last 15 games, and an opponent adjustment from
  how that team treats his position.
- `sd_fp` — from his own game log. A 30-point average with a 14-point spread is a different
  asset from a 30-point average with a 5-point spread, and every "projection" that reports
  only a mean hides exactly the thing that decides close weeks.
- `p_play` — chance he suits up at all: injury status, rest patterns, suspension, the legal
  and personal events below.

**Step 3 — the week.** Your total is the sum over every game your starters play. Draw 20,000
weeks:

```
for each simulated week:
    for each day, for each roster slot:
        pick the lineup the way the app's bestLineup does
        for each starter with a game:
            play? ~ Bernoulli(p_play)
            fp    ~ Normal(mean_fp, sd_fp) scaled by a shared per-game pace factor
    my_total vs opp_total
P(win) = share of weeks I come out ahead
```

Two correlations that matter and that naive simulations get wrong: teammates compete for the
same minutes (negative), and players in the same real game share a pace (positive). A shared
per-game factor covers the second; a minutes budget per NBA team covers the first.

**Step 4 — the breakdown.** The probability alone is a party trick. What you want beside it:

- Which of your players moves the number most if he sits.
- Which days of the week swing it (a Thursday with two games is a different animal).
- The games-played edge: often the whole matchup is "I have 41 games this week, he has 33".
- The one opponent player whose ceiling beats you on his own.

### The fine detail you asked for

**Historical matchups, and whether two players hate each other.** `nba_api` has the raw
material and this is the genuinely novel part:

- `leagueseasonmatchups` / `matchupsrollup` / `boxscorematchupsv3` — possession-level defender
  vs scorer. "Your man has shot 31% against this defender over 140 possessions" is real,
  checkable, and nothing in ESPN tells you.
- `playervsplayer`, `teamvsplayer`, `teamandplayersvsplayers` — career head-to-head splits.
- `playbyplayv3` — technical fouls, flagrants and ejections, with both players named. Count
  the pairs that keep showing up together and you have an actual friction table, not a vibe.
  Pair it with news coverage of the same two names and you can tell a grudge from a coincidence.

**How teams stack up.** `leaguedashptteamdefend` and `leaguedashteamstats` give pace, defensive
rating and what each team gives up by position. That is the opponent adjustment in step 2, and
it also answers "is this a good week to start my centre".

**Arrests, suspensions, legal trouble.** These are real and measurable, because they show up as
games missed. GDELT plus the news feeds already in `api/news.js` can flag them; the effect on
the model is `p_play`, not some mood multiplier.

**Divorce, and personal life generally.** Honest answer: there is no defensible way to turn
"got divorced" into a minutes number. Anyone who tells you otherwise is guessing with extra
steps. What the engine will do is surface the event, tagged, next to the player, and leave the
judgement to you. Tagging it is useful. Pretending to quantify it would make every number
downstream dishonest, including the one you actually care about.

**Calibration, or the whole thing is theatre.** Every projection gets stored before the games
are played, and scored after. If the model says 65% and you win 65% of those weeks over a
season, it works. If it says 65% and you win 50%, it is broken and the app should say so on
its face. A `projections` table you never grade is a horoscope.

---

## 3. Phases

Each one ships on its own and is useful alone.

| # | What | Why it is first |
|---|---|---|
| 1 | Supabase project, app state synced, sync code | You asked for it and it unblocks using the app on your phone |
| 2 | Worker skeleton: player game logs → `player_games`, nightly | Everything downstream needs the game log |
| 3 | `mean_fp` / `sd_fp` / `p_play` per player per game | The first real projection |
| 4 | Weekly simulation + the breakdown on **This week** | The number you asked for |
| 5 | Defence-vs-position and the opponent adjustment | Sharpens step 3 |
| 6 | Matchup history and the friction table | The detail nobody else has |
| 7 | Event feed: injuries, legal, suspensions → `p_play` | Catches the week-wreckers |
| 8 | Calibration page: what the model said vs what happened | Proves, or disproves, the whole thing |

Phases 1 and 2 are a weekend each. Phases 3 and 4 are the real work — a week of evenings, and
they are where the model either earns its keep or does not. Phase 8 is small and the most
important thing on the list.

## 4. Decisions

Settled 2026-10-19:

1. **Identity: magic link.** Supabase Auth, RLS on `auth.uid()`.
2. **Build order: phases 1 and 2 together** — persistence, then the nightly game-log pull.
3. **A new Supabase project**, priced at $0/month for your org. Kept away from nydex and
   underline, which have real users and Stripe keys.

Still open:

4. **Where the worker runs.** Your MacBook is the plan, but `stats.nba.com` has to answer it
   first: `python worker/ingest.py --check`. Phase 2 does not start until that prints OK.
5. **The Odds API key** — optional, phase 5, one email to register. Nothing else needs a key.
