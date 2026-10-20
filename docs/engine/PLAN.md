# Courtside engine — plan

Written 2026-10-19. Phases 1 to 5 are built; 6 onward is still a plan.

Two jobs, in this order:

1. **Make the app remember.** Everything lives in one browser's localStorage today, so your
   phone and your MacBook are two different apps.
2. **Build the engine.** A warehouse of NBA history and news, a projection per player per
   game, and a simulation that answers one question every week: what are my odds, and why.

---

## 1. Persistence — no database

Supabase is out. The free plan caps you at two projects and both are taken by nydex and
underline, which have real users and Stripe keys; a third costs $25/month and a shared schema
puts a toy dashboard in a production database. Neither is worth it, because the premise was
wrong anyway:

**Almost nothing needs syncing.** Look at what is actually in localStorage:

| Thing | Where it really lives |
|---|---|
| Scoring weights, slots, roster size, team count | **ESPN already has them**, in the `mSettings` view the app fetches. Read them, stop storing them. |
| Roster, who is taken, free agents | ESPN. Already read every load. |
| League id, team id | Two numbers. |
| espn_s2 / SWID | Credentials. Stay on the device. |

So the fix is not a database. It is deriving the settings from ESPN instead of keeping a hand
typed copy, which also kills a whole class of bug where the app's idea of your league drifts
from your league. What is left to move between devices is four short strings.

### Getting them onto the phone

The problem with "paste the cookies on each device" is that iOS Safari has no DevTools, so
there is no way to read a cookie on the phone. The answer is to carry them over from the Mac:

1. The Mac encrypts `{league, team, espn_s2, SWID}` with a six-digit code you choose
   (WebCrypto, AES-GCM, PBKDF2-stretched).
2. It builds a link with the ciphertext in the **fragment** — the part after `#`, which
   browsers never send to the server. AirDrop it to yourself.
3. The phone opens the link, you type the six digits, it decrypts and stores them locally.

No server, no storage, no vendor, nothing persisted anywhere that could leak. The ciphertext
exists only in a link you hand to yourself, and the code never travels with it.

### The engine's data

The worker writes **files into this repo**, not rows into a database:

- Raw game logs land in `worker/courtside.db`, a local SQLite file, gitignored. A season is
  about 27,000 rows; SQLite does not notice.
- The small derived artifacts — form, defence by position, matchup history, friction — get
  written to `data/*.json`, committed, and served as static files from Vercel's CDN.

A static JSON file on a CDN beats a database round trip for everything this site does, costs
nothing, and gives every number a commit that explains where it came from. The trade is that
new data arrives by deploy rather than instantly, which for a nightly job is not a trade at all.

## 2. The engine

### Shape

```
  nba_api / ESPN / GDELT / odds        courtside.db + data/*.json    the website
  ───────────────────────────────      ─────────────────────────    ───────────
  worker (Python, nightly)   ──────▶   SQLite, gitignored     ──────▶  reads only
  pulls, normalises, scores            small JSON, committed         never calls the
                                                                     slow sources itself
```

The website never waits on a slow source. The worker writes the files on a schedule; the pages
fetch them off the CDN. If the worker dies, the site keeps working on ESPN data, just with
staler numbers — and with no defence table it prices every night at face value, which is
exactly what it did before phase 5.

**The worker runs on the MacBook.** `stats.nba.com` refuses the sandbox I work in — a
60-second hang, 403 from the CDN — but answers your machine fine: all five endpoints the engine
needs came back, including 26,651 player game logs in 6 seconds and 147,805 possession-level
matchup rows in 16. Assume Vercel and GitHub Actions are blocked like the sandbox. The cost of
the laptop being the host is that the engine only refreshes when it is awake, which a nightly
job can live with.

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

**Step 3 — the week.** Built, and not as a simulation. A player-day is a coin flip and then
a draw — he plays or he does not, and if he plays his score varies — so it has mean `p·m` and
variance `p(s² + m²) − (p·m)²`. A week is forty of those added up, and the sum of forty
independent things is close enough to a bell curve that P(win) is just the chance one normal
lands above another. Instant, the same answer every time you look at it, and checkable by
hand, which a Monte Carlo with a random seed is not.

The starts are capped at ten a day and handed to the best players first, because you cannot
start thirteen men in ten slots and the bench would otherwise be counted as though it played.

What the closed form gives up: player-days are treated as independent, and they are not quite
— teammates share a ball, and two players in the same real game share its pace. The error is
small next to the spread of the players themselves and it makes the extremes a little
overconfident. If phase 8 shows that bias is real, a shared per-game factor and a per-team
minutes budget are the fix, and that is when a simulation earns its keep.

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
| 1 | **Done.** Encrypted device link carries the connection to the phone | You asked for it, and it needed no database |
| 2 | **Done.** Worker pulls game logs to SQLite, writes `public/data/form.json` | Everything downstream needs the game log |
| 3 | **Done.** `mean_fp` / `sd_fp` / `p_play` per player, in `src/lib/predict.js` | The first real projection |
| 4 | **Done.** Win probability and the breakdown on **This week** | The number you asked for |
| 5 | **Done.** Defence-vs-position, in `public/data/dvp.json` and `opponentFactor` | Sharpens step 3 |
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
3. **No database.** Settings come from ESPN, the four strings that are left move by encrypted
   link, and the engine's data lives in `data/*.json` in this repo. Supabase's free plan was
   full and nothing here was worth $25/month.
4. **The worker runs on the MacBook**, verified 2026-10-19 against all five endpoints.

Still open:

5. **The Odds API key** — optional, one email to register. Phase 5 shipped without it: the
   defence table is built from the game logs already in `courtside.db`, so no new key was
   needed. Vegas totals would still be the best sanity check on a projection if you want one.

Settled 2026-10-19, phase 5:

6. **Defence is measured per 36 minutes, not per game.** Fantasy points allowed per game
   mostly measures how many minutes the opposing coach handed out, which is a fact about
   their rotation rather than about this defence. Per 36 asks the narrower question the
   projection needs: against these people, is a minute worth more or less than usual?
7. **Guard / forward / centre, not five positions.** Split it finer and most team-position
   cells rest on too few games to read.
8. **Shrunk, then clipped.** Each cell is pulled towards 1.00 by sample size (K = 150
   player-games) and then clipped at ±12%. Defence-vs-position is half schedule artefact,
   and a table built on forty possessions will tell you anything you want to hear. Against
   last season's logs the extremes came out Boston and Detroit hardest, Washington and Utah
   softest, which is the right answer and a sign the table is reading real defence.
