"""Courtside worker. Pulls NBA game logs into a local SQLite file and writes the small
derived artifacts the website reads.

    python ingest.py --check      can this machine reach stats.nba.com?
    python ingest.py logs         pull player game logs into courtside.db
    python ingest.py form         recompute rolling form from what is in the db
    python ingest.py export       write ../public/data/form.json for the site
    python ingest.py dvp          defence by position -> ../public/data/dvp.json
    python ingest.py pbp          play-by-play for flagrants and technicals (slow, resumable)
    python ingest.py friction     pairings -> ../public/data/friction.json
    python ingest.py matchups     defender vs scorer -> ../public/data/matchups.json
    python ingest.py all          logs, form, export, dvp, friction, matchups
    python ingest.py --selfcheck  asserts on the pure parts (no network)

Runs on the laptop, not a server: NBA refuses datacenter IPs. See ../docs/engine/SOURCES.md.
When stats.nba.com does not answer, `logs` falls back to ESPN's public box scores (no key, no
cookies). Your ESPN account is never touched here: the browser does that, with credentials
that stay on your devices.
"""
import argparse
import json
import math
import os
import sqlite3
import sys
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "courtside.db")
DATA = os.path.join(HERE, os.pardir, "public", "data")  # Vite serves public/ at the site root

THIS_SEASON = "2026-27"   # the 2026-27 NBA season; ESPN calls it 2027 in api/players.js
LAST_SEASON = "2025-26"
SEASON_START = "2026-10-20"   # opening night of THIS_SEASON; the ESPN back-fill starts here

# ESPN's public scoreboard and box scores. Used when stats.nba.com hangs (it timed out from
# this Mac all evening on 2026-11-19); same stats, keyed by ESPN ids and abbreviations.
ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
ESPN_DELAY = 0.4   # seconds between uncached calls: one person's nightly job, not a crawler
# ESPN and the NBA disagree about six abbreviations. The db, dvp.json and predict.js all use
# the NBA's, so ESPN rows are translated on the way in (predict.js holds the same map).
NBA_ABBREV = {"GS": "GSW", "NO": "NOP", "NY": "NYK", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}

# Your league's scoring, mirroring DEFAULT_WEIGHTS in src/lib/model.js. A fantasy point here
# has to mean the same thing it means in the app, or every number downstream is a different
# currency. ftm 2 / fta -1 is ESPN's "+1 made, -1 missed" written as made/attempted.
WEIGHTS = {"pts": 1, "tpm": 1, "fgm": 2, "fga": -1, "ftm": 2, "fta": -1,
           "reb": 1, "ast": 2, "stl": 4, "blk": 4, "to": -2}

# Defence by position. Three knobs, all of them deliberately cautious, because defence-vs-
# position is the noisiest thing in fantasy basketball: half of what looks like a soft defence
# is a soft schedule, and a table built on forty possessions will tell you anything you want.
DVP_K = 150        # shrinkage, in player-games. A full season against one team is ~300, so a
                   # team is still pulled a third of the way back to average by the end of it.
DVP_CLAMP = 0.12   # no opponent moves a projection by more than this, whatever the table says
DVP_MIN_MIN = 10   # a garbage-time cameo says nothing about a defence

# Defender vs scorer. Thirty possessions is roughly a quarter of real coverage: under that
# the field-goal percentage is a coin flip wearing a decimal point.
MATCHUP_MIN_POSS = 30
MATCHUP_TOP_N = 8  # defenders kept per scorer, most-guarded first

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"),
    "Referer": "https://www.nba.com/", "Origin": "https://www.nba.com",
    "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive", "x-nba-stats-origin": "stats", "x-nba-stats-token": "true",
    "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
}

SCHEMA = """
create table if not exists player_games (
  player_id integer not null,
  game_id   text not null,
  season    text not null,
  game_date text not null,
  team      text,
  matchup   text,
  min numeric, pts integer, reb integer, ast integer, stl integer, blk integer,
  [to] integer, fgm integer, fga integer, ftm integer, fta integer, tpm integer,
  fp  numeric not null,
  primary key (player_id, game_id)
);
create index if not exists player_games_date on player_games (game_date);

create table if not exists players (
  player_id integer primary key,
  name text not null,
  norm text not null,
  team text
);
create index if not exists players_norm on players (norm);

create table if not exists player_pos (
  player_id integer primary key,
  pos text not null            -- G, F or C: finer than this and the cells are too thin to read
);

-- Which games the play-by-play has already been read for. The pull is a thousand calls at
-- a second each, so it has to survive being interrupted and pick up where it stopped.
create table if not exists pbp_games (
  game_id text primary key,
  season  text not null,
  at      text not null
);

-- Only the handful of events worth keeping, already resolved into pairs. Storing every
-- action would be half a million rows to answer a question about a few hundred.
create table if not exists friction_events (
  game_id text not null, season text not null, game_date text,
  kind text not null,              -- flagrant | technical | double technical
  period integer, clock text,
  player_id integer, player_name text,
  other_id integer, other_name text
);
create index if not exists friction_pair on friction_events (player_id, other_id);

create table if not exists runs (
  job text not null, season text not null, at text not null, rows integer not null
);

-- ESPN responses already fetched. A final box score never changes, so it is read once;
-- a scoreboard is kept only once every game on it is over.
create table if not exists espn_cache (
  url text primary key, body text not null, at text not null
);
"""


def norm_name(s):
    """Match src/lib/model.js normName: this is the join between NBA ids and ESPN ids."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = "".join(c if c.isalpha() or c == " " else "" for c in s)
    drop = {"jr", "sr", "ii", "iii", "iv"}
    return " ".join(w for w in s.split() if w not in drop)


def db():
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    return con


def get(path, params, tries=4, timeout=40):
    """stats.nba.com hangs on one call and answers the next. A hang means later, not blocked."""
    delay = 3
    for attempt in range(1, tries + 1):
        try:
            r = requests.get(f"https://stats.nba.com/stats/{path}", params=params,
                             headers=HEADERS, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            print(f"    HTTP {r.status_code} on {path}, attempt {attempt}")
        except requests.exceptions.RequestException as e:
            print(f"    {type(e).__name__} on {path}, attempt {attempt}")
        if attempt < tries:
            time.sleep(delay)
            delay *= 2
    raise SystemExit(f"{path} would not answer after {tries} tries. Try again later.")


def rows_of(payload, index=0):
    rs = payload["resultSets"][index]
    head = rs["headers"]
    return [dict(zip(head, row)) for row in rs["rowSet"]]


def fantasy_points(r):
    line = {"pts": r["PTS"], "tpm": r["FG3M"], "fgm": r["FGM"], "fga": r["FGA"],
            "ftm": r["FTM"], "fta": r["FTA"], "reb": r["REB"], "ast": r["AST"],
            "stl": r["STL"], "blk": r["BLK"], "to": r["TOV"]}
    return round(sum((line[k] or 0) * w for k, w in WEIGHTS.items()), 2)


# ---------------------------------------------------------------- jobs

def job_logs(seasons):
    """One try at stats.nba.com per season. If it hangs, this season comes from ESPN's box
    scores instead, and a past season keeps the rows already stored."""
    con = db()
    total = 0
    for season in seasons:
        print(f"  {season}: asking for every player game log…")
        try:
            payload = get("playergamelogs", {
                "Season": season, "SeasonType": "Regular Season", "LeagueID": "00",
                "PerMode": "Totals", "MeasureType": "Base",
            }, tries=1, timeout=15)
        except SystemExit as e:
            print(f"  {e}")
            if season == THIS_SEASON:
                total += job_logs_espn(espn_dates())
            else:
                n = con.execute("select count(*) from player_games where season = ?",
                                (season,)).fetchone()[0]
                print(f"  {season}: kept the {n} rows already stored")
            continue
        rows = rows_of(payload)
        print(f"  {season}: {len(rows)} rows")
        with con:
            # The NBA pull is the whole season, so it replaces any ESPN rows (ESPN event ids do
            # not start with 00) rather than storing the same games twice under two ids.
            if rows:
                con.execute("delete from player_games where season = ? and game_id not like '00%'",
                            (season,))
            for r in rows:
                con.execute(
                    "insert or replace into player_games values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (r["PLAYER_ID"], r["GAME_ID"], season, (r["GAME_DATE"] or "")[:10],
                     r.get("TEAM_ABBREVIATION"), r.get("MATCHUP"),
                     r["MIN"], r["PTS"], r["REB"], r["AST"], r["STL"], r["BLK"], r["TOV"],
                     r["FGM"], r["FGA"], r["FTM"], r["FTA"], r["FG3M"], fantasy_points(r)))
                con.execute("insert or replace into players values (?,?,?,?)",
                            (r["PLAYER_ID"], r["PLAYER_NAME"], norm_name(r["PLAYER_NAME"]),
                             r.get("TEAM_ABBREVIATION")))
            con.execute("insert into runs values (?,?,?,?)",
                        ("logs", season, datetime.now(timezone.utc).isoformat(), len(rows)))
        total += len(rows)
        time.sleep(2)
    print(f"  stored {total} rows in {os.path.relpath(DB)}")
    return total


# ---------------------------------------------------------------- ESPN box scores

def today_et():
    """NBA dates are US Eastern; ESPN's scoreboard ?dates= is too."""
    return datetime.now(ZoneInfo("America/New_York")).date()


def espn_dates(start=SEASON_START, end=None):
    """Every date from opening night to today. Past dates are cached, so re-reading them is
    free, and a night that failed last time gets filled in this time."""
    d, end = date.fromisoformat(start), end or today_et()
    out = []
    while d <= end:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def espn_get(con, url, keep):
    """JSON from ESPN, from the cache when we have it. `keep(payload)` decides whether this
    answer is final enough to cache. Sequential and slow on purpose."""
    hit = con.execute("select body from espn_cache where url = ?", (url,)).fetchone()
    if hit:
        return json.loads(hit[0])
    for attempt in (1, 2):
        time.sleep(ESPN_DELAY * attempt)
        try:
            r = requests.get(url, headers={"User-Agent": HEADERS["User-Agent"]}, timeout=20)
            if r.status_code == 200:
                payload = r.json()
                if keep(payload):
                    with con:
                        con.execute("insert or replace into espn_cache values (?,?,?)",
                                    (url, r.text, datetime.now(timezone.utc).isoformat()))
                return payload
            print(f"    HTTP {r.status_code} on {url}")
        except (requests.exceptions.RequestException, ValueError) as e:
            print(f"    {type(e).__name__} on {url}")
    return None


def made_att(s):
    """ESPN writes field goals as "5-11". Returns (5, 11); (0, 0) for anything odd."""
    try:
        m, a = s.split("-")
        return int(m), int(a)
    except (AttributeError, ValueError):
        return 0, 0


def num(s):
    try:
        return int(s)
    except (TypeError, ValueError):
        return 0


def espn_lines(summary):
    """One NBA-shaped stat line per player who played, from an ESPN summary payload."""
    teams = {t["team"]["id"]: (NBA_ABBREV.get(t["team"]["abbreviation"], t["team"]["abbreviation"]),
                               t.get("homeAway"))
             for t in summary["header"]["competitions"][0]["competitors"]}
    out = []
    for side in summary.get("boxscore", {}).get("players", []):
        team, home_away = teams.get(side["team"]["id"], (None, None))
        opp = next((a for k, (a, _) in teams.items() if k != side["team"]["id"]), None)
        for block in side.get("statistics", []):
            col = {k: i for i, k in enumerate(block.get("names") or block.get("labels") or [])}
            for a in block.get("athletes", []):
                st = a.get("stats") or []
                if a.get("didNotPlay") or not st:
                    continue
                v = lambda k: st[col[k]] if k in col and col[k] < len(st) else None
                fgm, fga = made_att(v("FG"))
                tpm, tpa = made_att(v("3PT"))
                ftm, fta = made_att(v("FT"))
                out.append({
                    "espn_id": int(a["athlete"]["id"]), "name": a["athlete"]["displayName"],
                    "pos": (a["athlete"].get("position") or {}).get("abbreviation") or "",
                    "TEAM_ABBREVIATION": team,
                    "MATCHUP": f"{team} {'vs.' if home_away == 'home' else '@'} {opp}",
                    "MIN": num(v("MIN")), "PTS": num(v("PTS")), "REB": num(v("REB")),
                    "AST": num(v("AST")), "STL": num(v("STL")), "BLK": num(v("BLK")),
                    "TOV": num(v("TO")), "FGM": fgm, "FGA": fga, "FTM": ftm, "FTA": fta,
                    "FG3M": tpm,
                })
    return out


def job_logs_espn(dates, season=THIS_SEASON):
    """Box scores from ESPN: one scoreboard per date, one summary per finished game. Writes
    the same player_games rows the NBA pull does. A player is joined to his NBA id by
    normalised name; a rookie the db has never seen is stored under his ESPN id, negated,
    so the two id spaces cannot collide."""
    con = db()
    by_norm = {n: pid for pid, n in con.execute("select player_id, norm from players order by player_id")}  # NBA ids (positive) win a tie
    today = today_et().isoformat()
    rows = games = fresh = 0
    print(f"  {season}: ESPN box scores, {dates[0]} to {dates[-1]}")
    for d in dates:
        sb = espn_get(con, f"{ESPN_SITE}/scoreboard?dates={d.replace('-', '')}",
                      keep=lambda p, d=d: d < today and all(
                          e["status"]["type"].get("state") == "post" for e in p.get("events", [])))
        if sb is None:
            print(f"    {d}: no scoreboard, skipped; the next run will retry it")
            continue
        for e in sb.get("events", []):
            if not e["status"]["type"].get("completed"):
                continue
            url = f"{ESPN_SITE}/summary?event={e['id']}"
            cached = con.execute("select 1 from espn_cache where url = ?", (url,)).fetchone()
            summary = espn_get(con, url, keep=lambda p: True)
            if summary is None:
                continue
            fresh += not cached
            games += 1
            with con:
                for r in espn_lines(summary):
                    norm = norm_name(r["name"])
                    pid = by_norm.get(norm)
                    if pid is None:
                        pid = by_norm[norm] = -r["espn_id"]
                    con.execute("insert or replace into players values (?,?,?,?)",
                                (pid, r["name"], norm, r["TEAM_ABBREVIATION"]))
                    if r["pos"]:   # dvp buckets by G/F/C; NBA ids already have one from playerindex
                        con.execute("insert or ignore into player_pos values (?,?)",
                                    (pid, r["pos"][0].upper()))
                    con.execute(
                        "insert or replace into player_games values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (pid, str(e["id"]), season, d, r["TEAM_ABBREVIATION"], r["MATCHUP"],
                         r["MIN"], r["PTS"], r["REB"], r["AST"], r["STL"], r["BLK"], r["TOV"],
                         r["FGM"], r["FGA"], r["FTM"], r["FTA"], r["FG3M"], fantasy_points(r)))
                    rows += 1
    with con:
        con.execute("insert into runs values (?,?,?,?)",
                    ("logs-espn", season, datetime.now(timezone.utc).isoformat(), rows))
    print(f"  {season}: {games} finished games ({fresh} fetched, the rest cached), {rows} player rows")
    return rows


def form_rows(con, season, min_games=5):
    """Mean and standard deviation of fantasy points per player, plus how often he suits up.

    The sd is the point: a 30-point average with a 14-point spread is a different asset from
    one with a 5-point spread, and a projection that reports only a mean hides what decides
    close weeks. Availability is the other half — a 40-point player who plays 55 games is
    worth less over a week than a 34-point player who plays 78."""
    names = dict(con.execute("select player_id, name from players"))
    rows = [(pid, gid, d, team, mins or 0, fp) for pid, gid, d, team, mins, fp in con.execute(
        "select player_id, game_id, game_date, team, min, fp from player_games"
        " where season = ? order by game_date, game_id", (season,))]
    schedule, miss, em = team_nights(rows)
    hist = {}
    for r in reversed(rows):   # newest first, per player
        hist.setdefault(r[0], []).append(r)

    out = []
    for pid, h in hist.items():
        last = h[:25]
        if len(last) < min_games or pid not in names:
            continue
        fps = [r[5] for r in last]
        mins = [r[4] for r in last]
        mean = sum(fps) / len(fps)
        var = sum((x - mean) ** 2 for x in fps) / (len(fps) - 1)
        min_proj, fp_proj = minutes_first([(r[4], r[5]) for r in h])
        # His team now is the team of his latest game; its calendar is the yardstick for
        # availability and for the games he has missed lately.
        team = h[0][3]
        cal = schedule.get(team, [])
        mine = {r[1] for r in h}
        missed3 = sum(1 for g in cal[-3:] if g not in mine)
        gap = 0
        for g in reversed(cal):
            if g in mine:
                break
            gap += 1
        name = names[pid]
        out.append({
            "name": name, "nba_id": pid, "team": team, "norm": norm_name(name),
            "g": len(fps),
            "mpg": round(sum(mins) / len(mins), 1),
            "fp_mean": round(mean, 2),
            "fp_sd": round(math.sqrt(var), 2),
            # Share of his team's games he actually appeared in. Traded players look worse
            # than they are here, which is why it is a prior the injury report overrides.
            "avail": round(min(1.0, len(h) / len(cal)), 3) if cal else None,
            "fp_proj": round(fp_proj, 2), "min_proj": round(min_proj, 1),
            "missed3": missed3, "gap": gap, "last_game": h[0][2],
            "miss_avg": round(sum(miss.get((pid, r[1]), 0) for r in last) / len(last), 1),
            "min_recent": round(em.get(pid, 0), 1),
        })
    out.sort(key=lambda r: -r["fp_mean"])
    return out


# Minutes first (spec change 2, fitted on weeks 3-13 of 2025-26 in worker/experiments).
MIN_HALF_LIFE = 8      # games: minutes move fast
RATE_HALF_LIFE = 40    # games: points per minute moves slowly
RATE_PRIOR_MIN = 100   # minutes of weight pulling the rate to the pool's
POOL_RATE = 1.276      # fantasy points a minute across the pool


def minutes_first(games):
    """games newest first as [(min, fp)]. Returns (min_proj, fp_proj): a fast minutes
    estimate times a slow, shrunk points-per-minute rate. Must match formFrom in backtest.mjs."""
    wm = [0.5 ** (k / MIN_HALF_LIFE) for k in range(len(games))]
    wr = [0.5 ** (k / RATE_HALF_LIFE) for k in range(len(games))]
    min_proj = sum(w * m for w, (m, _) in zip(wm, games)) / sum(wm)
    rate = ((sum(w * fp for w, (_, fp) in zip(wr, games)) + RATE_PRIOR_MIN * POOL_RATE)
            / (sum(w * m for w, (m, _) in zip(wr, games)) + RATE_PRIOR_MIN))
    return min_proj, min_proj * rate


def team_nights(rows):
    """One pass in date order, ported from enrich() in worker/experiments/lib.mjs.
    rows: (pid, gid, date, team, min, fp), oldest first. Returns
      schedule  team -> its game ids in date order
      miss      (pid, gid) -> running minutes of teammates who played in one of the team's
                last 10 games and sat this one, counted before the game (spec change 5)
      em        pid -> his running minutes average after his latest game"""
    games = {}
    for r in rows:
        games.setdefault(r[1], {}).setdefault(r[3], []).append(r)
    schedule, miss, em, last, cur, members = {}, {}, {}, {}, {}, {}
    for gid, sides in games.items():   # dicts keep insertion order, which is date order
        for team, rs in sides.items():
            i = len(schedule.get(team, []))
            playing = {r[0] for r in rs if r[4] > 0}
            m = sum(em[p] for p in members.get(team, ()) if p not in playing and i - last[p] <= 10)
            for r in rs:
                miss[(r[0], gid)] = m
        for team, rs in sides.items():
            i = len(schedule.get(team, []))
            for pid, _, _, _, mins, _ in rs:
                if mins <= 0:
                    continue
                em.setdefault(pid, mins)
                if cur.get(pid) != team:
                    members.get(cur.get(pid), set()).discard(pid)
                    members.setdefault(team, set()).add(pid)
                    cur[pid] = team
                em[pid] += 0.25 * (mins - em[pid])
                last[pid] = i
            schedule.setdefault(team, []).append(gid)
    return schedule, miss, em


def selfcheck():
    """The pure parts, no network. python3 -I ingest.py --selfcheck"""
    g8 = [(m, m) for m in (30, 30, 30, 30, 20, 20, 20, 20)]   # newest first; plain mean 25
    _, fp8 = minutes_first(g8)
    assert abs(fp8 - 28.32) < 0.01, fp8
    assert made_att("5-11") == (5, 11) and made_att("") == (0, 0)
    # Team A plays 4 games; p2 (34 min) sits the last two. Before game 3, 34 minutes are
    # missing; p2 has missed 2 of the last 3 and 2 in a row.
    rows = []
    for k in range(4):
        rows.append((1, f"g{k}", f"2026-11-0{k + 1}", "A", 30, 30.0))
        if k < 2:
            rows.append((2, f"g{k}", f"2026-11-0{k + 1}", "A", 34, 40.0))
    sched, miss, em = team_nights(rows)
    assert sched["A"] == ["g0", "g1", "g2", "g3"]
    assert miss[(1, "g2")] == 34 and miss[(1, "g1")] == 0 and em[2] == 34
    con = sqlite3.connect(":memory:")
    con.executescript(SCHEMA)
    for pid, gid, d, team, mins, fp in rows:
        con.execute("insert into player_games (player_id, game_id, season, game_date, team, min, fp)"
                    " values (?,?,?,?,?,?,?)", (pid, gid, "x", d, team, mins, fp))
    con.executemany("insert into players values (?,?,?,?)", [(1, "One", "one", "A"), (2, "Two", "two", "A")])
    two = {r["nba_id"]: r for r in form_rows(con, "x", min_games=1)}[2]
    assert (two["missed3"], two["gap"], two["avail"], two["last_game"]) == (2, 2, 0.5, "2026-11-02"), two
    print(f"selfcheck ok: fp_proj {fp8:.2f} for the eight-game case")
    return 0


def job_form():
    con = db()
    for season in (THIS_SEASON, LAST_SEASON):
        rows = form_rows(con, season)
        if rows:
            print(f"  {season}: form for {len(rows)} players, "
                  f"top {rows[0]['name']} {rows[0]['fp_mean']} ± {rows[0]['fp_sd']}")
            return season, rows
    print("  no season has enough games yet")
    return None, []


def job_export():
    season, rows = job_form()
    if not rows:
        return 0
    os.makedirs(DATA, exist_ok=True)
    path = os.path.join(DATA, "form.json")
    payload = {
        # Eastern time with its offset: the date matches the NBA's night, and Date.parse reads it.
        "updated": datetime.now(ZoneInfo("America/New_York")).isoformat(timespec="seconds"),
        "season": season,
        # Whether these are this season's own games or last season's, which decides how much
        # weight the app gives them against ESPN's projection.
        "is_current_season": season == THIS_SEASON,
        "scoring": WEIGHTS,
        "note": ("Fantasy points under Grace One Charlotte FBL scoring, last 25 games. "
                 "fp_sd is the game-to-game spread, not an error bar. avail is the share of "
                 "his team's games he appeared in, a prior the live injury report overrides."),
        "players": rows,
    }
    with open(path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"  wrote {os.path.relpath(path)} — {len(rows)} players, "
          f"{os.path.getsize(path) // 1024} KB")
    return len(rows)


# ---------------------------------------------------------------- defence by position

def job_positions(season):
    """Guard, forward or centre per player. The game log does not carry it, so it comes from
    playerindex — one call, 500-odd rows."""
    payload = get("playerindex", {"LeagueID": "00", "Season": season})
    rows = rows_of(payload)
    con = db()
    with con:
        for r in rows:
            pos = (r.get("POSITION") or "").strip()
            if not pos:
                continue
            # "G-F" is a guard who swings; the first letter is the one his minutes come from.
            con.execute("insert or replace into player_pos values (?,?)",
                        (r["PERSON_ID"], pos[0].upper()))
    n = con.execute("select count(*) from player_pos").fetchone()[0]
    print(f"  {season}: positions for {len(rows)} players, {n} known in total")
    return n


def opponent_of(matchup):
    """'BOS vs. LAL' and 'BOS @ LAL' both end with the other team."""
    parts = (matchup or "").split()
    return parts[-1] if len(parts) >= 3 else None


def dvp_rows(con, season):
    """What each team gives up, per position, per 36 minutes on the floor.

    Per 36 rather than per game on purpose. Fantasy points allowed per game mostly measures
    how many minutes the opposing coach handed out, which is a fact about the other team's
    rotation, not about this defence. Per 36 asks the narrower question the projection
    actually needs: against these people, does a minute produce more or less than usual?

    Returned as a multiplier against the league average for that position, shrunk towards 1
    by how many player-games it rests on and then clipped. A team with no history gets 1.00,
    which is the right answer rather than a missing one."""
    pos = dict(con.execute("select player_id, pos from player_pos"))
    if not pos:
        return {}, {}, 0

    league = {}   # bucket -> [sum of fp36, n]
    allowed = {}  # (team, bucket) -> [sum of fp36, n]
    skipped = 0
    for pid, matchup, mins, fp in con.execute(
            "select player_id, matchup, min, fp from player_games"
            " where season = ? and min >= ?", (season, DVP_MIN_MIN)):
        bucket = pos.get(pid)
        opp = opponent_of(matchup)
        if not bucket or not opp or not mins:
            skipped += 1
            continue
        fp36 = fp / mins * 36
        for key, store in ((bucket, league), ((opp, bucket), allowed)):
            cell = store.setdefault(key, [0.0, 0])
            cell[0] += fp36
            cell[1] += 1

    base = {b: total / n for b, (total, n) in league.items() if n}
    teams = {}
    for (team, bucket), (total, n) in sorted(allowed.items()):
        mean = total / n
        ref = base.get(bucket)
        if not ref:
            continue
        # Shrink towards average by sample size, then refuse to let any one cell move a
        # projection more than DVP_CLAMP whatever it claims.
        mult = 1 + (mean / ref - 1) * (n / (n + DVP_K))
        mult = min(1 + DVP_CLAMP, max(1 - DVP_CLAMP, mult))
        teams.setdefault(team, {})[bucket] = {
            "mult": round(mult, 4), "fp36": round(mean, 2), "n": n,
        }
    return teams, {b: round(v, 2) for b, v in base.items()}, skipped


def job_dvp():
    con = db()
    for season in (THIS_SEASON, LAST_SEASON):
        if not con.execute("select 1 from player_games where season = ? limit 1",
                           (season,)).fetchone():
            continue
        try:
            job_positions(season)
        except SystemExit as e:   # NBA down: ESPN rows carry their own G/F/C (job_logs_espn)
            print(f"  {e} Using the {con.execute('select count(*) from player_pos').fetchone()[0]} positions stored.")
        teams, base, skipped = dvp_rows(con, season)
        if len(teams) < 20:
            print(f"  {season}: only {len(teams)} teams have enough games; trying the season before")
            continue
        path = os.path.join(DATA, "dvp.json")
        os.makedirs(DATA, exist_ok=True)
        payload = {
            "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "season": season,
            "is_current_season": season == THIS_SEASON,
            "k": DVP_K, "clamp": DVP_CLAMP, "min_minutes": DVP_MIN_MIN,
            "note": ("Fantasy points per 36 minutes allowed to guards, forwards and centres, "
                     "as a multiplier on the league average for that position. Shrunk towards "
                     "1.00 by sample size and clipped at +/-" f"{int(DVP_CLAMP * 100)}%. "
                     "Scoring matches form.json. Defence-vs-position is noisy and partly a "
                     "schedule artefact, which is what the shrinking and the clip are for."),
            "league_fp36": base,
            "teams": teams,
        }
        with open(path, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        extremes = sorted(((t["G"]["mult"], name) for name, t in teams.items() if "G" in t))
        print(f"  {season}: {len(teams)} teams, {skipped} rows without a position or opponent")
        if extremes:
            print(f"  toughest on guards {extremes[0][1]} {extremes[0][0]}, "
                  f"softest {extremes[-1][1]} {extremes[-1][0]}")
        print(f"  wrote {os.path.relpath(path)} — {os.path.getsize(path) // 1024} KB")
        with con:
            con.execute("insert into runs values (?,?,?,?)",
                        ("dvp", season, datetime.now(timezone.utc).isoformat(), len(teams)))
        return len(teams)
    print("  no season has enough games for a defence table yet")
    return 0


# ---------------------------------------------------------------- defender vs scorer

def job_matchups(season):
    """Who guards whom, and how it goes. One call, about 150,000 pairs, cut to the ones
    that rest on enough coverage to mean anything.

    This is the part of the engine that nothing else has. ESPN will tell you a player
    averages 28; it will not tell you he has shot 31% against the man waiting for him on
    Thursday. The cut is deliberate: under MATCHUP_MIN_POSS possessions a field-goal
    percentage is noise with a decimal point, and showing it would be worse than silence."""
    # Where those defenders play *now*, not where they played when the possessions happened.
    # Without this the table is trivia; with it the app can say which of them he actually
    # runs into this week.
    now = {}
    for r in rows_of(get("playerindex", {"LeagueID": "00", "Season": THIS_SEASON})):
        if r.get("TEAM_ABBREVIATION"):
            now[r["PERSON_ID"]] = r["TEAM_ABBREVIATION"]

    payload = get("leagueseasonmatchups", {
        "LeagueID": "00", "Season": season, "SeasonType": "Regular Season",
        "PerMode": "Totals"}, timeout=90)
    rows = [r for r in rows_of(payload) if (r["PARTIAL_POSS"] or 0) >= MATCHUP_MIN_POSS]
    by_scorer = {}
    for r in rows:
        by_scorer.setdefault(r["OFF_PLAYER_ID"], []).append(r)

    out = {}
    names = {}
    for pid, rs in by_scorer.items():
        rs.sort(key=lambda r: -r["PARTIAL_POSS"])
        names[pid] = rs[0]["OFF_PLAYER_NAME"]
        kept = []
        for r in rs[:MATCHUP_TOP_N]:
            poss = r["PARTIAL_POSS"]
            fga = r["MATCHUP_FGA"] or 0
            names[r["DEF_PLAYER_ID"]] = r["DEF_PLAYER_NAME"]
            kept.append({
                "d": r["DEF_PLAYER_ID"],
                "gp": r["GP"],
                "poss": round(poss, 1),
                # Per 100 possessions, because the whole point is comparing defenders who
                # guarded him for wildly different amounts of time.
                "pts100": round((r["PLAYER_PTS"] or 0) / poss * 100, 1),
                "fga": round(fga, 1),
                # None, not 0: "he has not shot against this man" and "he shoots 0%" are
                # different facts and only one of them is an indictment.
                "fg": round(r["MATCHUP_FG_PCT"], 3) if fga >= 10 else None,
                "tov": round(r["MATCHUP_TOV"] or 0, 1),
            })
        out[pid] = kept

    path = os.path.join(DATA, "matchups.json")
    os.makedirs(DATA, exist_ok=True)
    payload = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "season": season,
        "min_poss": MATCHUP_MIN_POSS, "top_n": MATCHUP_TOP_N,
        "note": ("Defender vs scorer, possession by possession, from leagueseasonmatchups. "
                 "pts100 is points scored against that defender per 100 partial possessions; "
                 "fg is field-goal percentage in those possessions, null under 10 attempts. "
                 "Only pairs with at least " f"{MATCHUP_MIN_POSS} possessions, top "
                 f"{MATCHUP_TOP_N} defenders per scorer."),
        "names": {str(k): v for k, v in names.items()},
        # ESPN writes Jokic, the NBA writes Jokić. Same normalisation as form.json, so the
        # app joins on a name it can actually produce from its own player list.
        "by_norm": {norm_name(names[k]): k for k in out},
        # Defender id -> the team he is on this season. Missing means out of the league.
        "now": {str(k): v for k, v in now.items() if k in names},
        "scorers": {str(k): v for k, v in out.items()},
    }
    with open(path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    placed = sum(1 for k in names if k in now)
    print(f"  {season}: {len(rows)} pairs over {MATCHUP_MIN_POSS} possessions, "
          f"{len(out)} scorers kept, {placed}/{len(names)} still on an NBA roster")
    print(f"  wrote {os.path.relpath(path)} \u2014 {os.path.getsize(path) // 1024} KB")
    return len(out)


# ---------------------------------------------------------------- friction

# What counts. A single technical names only the man who got it: the free throw that follows
# is shot by whoever his opponent nominates, so it says nothing about who he was arguing
# with. A flagrant is different — the man fouled shoots the free throws himself, at the same
# clock, which is what makes the pair recoverable. Two technicals on the same whistle from
# opposite teams is the other honest pair.
FLAGRANT_FT = "Free Throw Flagrant"


def pbp_events(game_id, actions):
    """Resolve one game's actions into friction pairs. Returns a list of rows."""
    ft_by_moment = {}
    for a in actions:
        if (a.get("subType") or "").startswith(FLAGRANT_FT):
            ft_by_moment.setdefault((a.get("period"), a.get("clock")), a)

    out = []
    techs = {}
    for a in actions:
        if a.get("actionType") != "Foul":
            continue
        sub = (a.get("subType") or "")
        moment = (a.get("period"), a.get("clock"))
        if sub.startswith("Flagrant"):
            victim = ft_by_moment.get(moment)
            out.append(["flagrant", a.get("period"), a.get("clock"),
                        a.get("personId"), a.get("playerName"),
                        victim.get("personId") if victim else None,
                        victim.get("playerName") if victim else None])
        elif sub == "Technical":
            # Non-Unsportsmanlike Technical is a delay of game, not a grudge. Excluded above
            # by the exact match.
            techs.setdefault(moment, []).append(a)

    for moment, group in techs.items():
        teams = {a.get("teamId") for a in group}
        if len(group) == 2 and len(teams) == 2:
            a, b = group
            out.append(["double technical", moment[0], moment[1],
                        a.get("personId"), a.get("playerName"),
                        b.get("personId"), b.get("playerName")])
        else:
            for a in group:
                out.append(["technical", moment[0], moment[1],
                            a.get("personId"), a.get("playerName"), None, None])
    return out


def job_pbp(season, limit=None):
    """Read play-by-play for every game not already read. A thousand calls at a second
    each, so it stores as it goes and picks up where it stopped."""
    con = db()
    done = {g for (g,) in con.execute("select game_id from pbp_games where season = ?", (season,))}
    games = [(g, d) for g, d in con.execute(
        "select distinct game_id, min(game_date) from player_games where season = ?"
        " group by game_id order by game_date", (season,)) if g not in done]
    if limit:
        games = games[:limit]
    if not games:
        print(f"  {season}: play-by-play already read for all {len(done)} games")
        return 0

    print(f"  {season}: {len(games)} games to read, {len(done)} already done "
          f"(about {len(games) // 60 + 1} minutes)")
    read = 0
    for i, (gid, date) in enumerate(games, 1):
        try:
            payload = get("playbyplayv3", {"GameID": gid, "StartPeriod": 0, "EndPeriod": 14},
                          tries=3, timeout=40)
        except SystemExit as e:
            print(f"  stopped at game {i} of {len(games)}: {e}")
            print("  already-read games are saved; run it again to carry on")
            break
        rows = pbp_events(gid, payload.get("game", {}).get("actions", []))
        with con:
            for kind, period, clock, pid, pname, oid, oname in rows:
                con.execute("insert into friction_events values (?,?,?,?,?,?,?,?,?,?)",
                            (gid, season, date, kind, period, clock, pid, pname, oid, oname))
            con.execute("insert or replace into pbp_games values (?,?,?)",
                        (gid, season, datetime.now(timezone.utc).isoformat()))
        read += 1
        if i % 100 == 0:
            print(f"    {i}/{len(games)} games")
        time.sleep(0.35)
    n = con.execute("select count(*) from friction_events where season = ?", (season,)).fetchone()[0]
    print(f"  read {read} games; {n} events stored for {season}")
    return read


def job_friction(season):
    """Pairs that keep turning up together. A table, not a verdict: two flagrants between
    the same men over a season is a fact, and whether it is a grudge is for you and the
    news feed to decide. The model does not touch it."""
    con = db()
    # Play-by-play gives the family name only — "Gobert", not "Rudy Gobert" — and the app
    # joins on the full name ESPN uses. Resolve through the id, which is the same in both
    # feeds, and keep the short name only when the id is a stranger.
    full = {pid: name for pid, name in con.execute("select player_id, name from players")}
    pairs = {}
    for kind, pid, pname, oid, oname, date in con.execute(
            "select kind, player_id, player_name, other_id, other_name, game_date"
            " from friction_events where season = ? and other_id is not null", (season,)):
        pname = full.get(pid, pname)
        oname = full.get(oid, oname)
        key = tuple(sorted([(pid, pname), (oid, oname)]))
        cell = pairs.setdefault(key, {"n": 0, "kinds": {}, "last": None})
        cell["n"] += 1
        cell["kinds"][kind] = cell["kinds"].get(kind, 0) + 1
        cell["last"] = max(cell["last"] or "", date or "")

    # Per player, counted from both ends. The first version only counted the man the event
    # was charged to, which quietly lost every player on the receiving end of a flagrant
    # and half of every double technical.
    tally = {}
    def bump(pid, name, key):
        if pid is None:
            return
        cell = tally.setdefault(pid, {"id": pid, "name": name, "tech": 0, "gave": 0, "took": 0})
        cell[key] += 1
    for kind, pid, pname, oid, oname in con.execute(
            "select kind, player_id, player_name, other_id, other_name"
            " from friction_events where season = ?", (season,)):
        pname = full.get(pid, pname)
        oname = full.get(oid, oname)
        if kind == "flagrant":
            bump(pid, pname, "gave")
            bump(oid, oname, "took")
        else:
            bump(pid, pname, "tech")
            if kind == "double technical":
                bump(oid, oname, "tech")
    tallies = sorted(tally.values(),
                     key=lambda r: -(r["tech"] + r["gave"] + r["took"]))[:40]

    out = []
    for (a, b), v in pairs.items():
        out.append({"a": a[0], "a_name": a[1], "a_norm": norm_name(a[1]),
                    "b": b[0], "b_name": b[1], "b_norm": norm_name(b[1]),
                    "n": v["n"], "kinds": v["kinds"], "last": v["last"]})
    out.sort(key=lambda r: (-r["n"], r["a_name"]))

    path = os.path.join(DATA, "friction.json")
    os.makedirs(DATA, exist_ok=True)
    payload = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "season": season,
        "note": ("Pairs of players named in the same flagrant foul or double technical, "
                 "from play-by-play. A flagrant pairs because the man fouled shoots the "
                 "free throws himself; a single technical names nobody else, so it is "
                 "counted in tallies and never paired. tech is technicals, gave is "
                 "flagrants committed, took is flagrants received. This feeds no projection \u2014 there is "
                 "no defensible way to turn a grudge into a minutes number. It is here to "
                 "be read."),
        "pairs": out,
        "tallies": tallies,
    }
    with open(path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    repeat = [r for r in out if r["n"] > 1]
    print(f"  {season}: {len(out)} pairs, {len(repeat)} of them more than once")
    for r in repeat[:5]:
        print(f"    {r['a_name']} / {r['b_name']} \u00d7{r['n']} {r['kinds']}")
    print(f"  wrote {os.path.relpath(path)} \u2014 {os.path.getsize(path) // 1024} KB")
    return len(out)


def check():
    try:
        payload = get("leaguedashptteamdefend", {
            "LeagueID": "00", "PerMode": "PerGame", "Season": LAST_SEASON,
            "SeasonType": "Regular Season", "DefenseCategory": "Overall"}, tries=2)
    except SystemExit as e:
        print(e)
        print("Run this on your laptop, not a server: NBA refuses datacenter IPs.")
        return 1
    print(f"OK: stats.nba.com answered with {len(rows_of(payload))} rows.")
    return 0


JOBS = {"logs": "pull player game logs into courtside.db",
        "form": "recompute rolling mean and spread from the db",
        "export": "write ../public/data/form.json for the website",
        "dvp": "defence by position -> ../public/data/dvp.json",
        "pbp": "play-by-play for flagrants and technicals (slow, resumable)",
        "friction": "pairings -> ../public/data/friction.json",
        "matchups": "defender vs scorer -> ../public/data/matchups.json",
        "all": "logs, form, export, dvp, friction, matchups (not pbp: run that on its own)"}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("job", nargs="?", choices=sorted(JOBS), help="; ".join(
        f"{k}: {v}" for k, v in JOBS.items()))
    ap.add_argument("--check", action="store_true", help="can this machine reach stats.nba.com?")
    ap.add_argument("--selfcheck", action="store_true", help="asserts on the pure parts, no network")
    ap.add_argument("--season", default=None, help="one season, e.g. 2025-26")
    ap.add_argument("--limit", type=int, default=None, help="pbp: stop after this many games")
    args = ap.parse_args()

    if args.check:
        return check()
    if args.selfcheck:
        return selfcheck()
    if not args.job:
        ap.print_help()
        return 0

    seasons = [args.season] if args.season else [THIS_SEASON, LAST_SEASON]
    start = time.time()
    if args.job in ("logs", "all"):
        job_logs(seasons)
    if args.job == "form":
        job_form()
    if args.job in ("export", "all"):
        job_export()
    if args.job in ("dvp", "all"):
        job_dvp()
    if args.job == "pbp":
        job_pbp(args.season or LAST_SEASON, limit=args.limit)
    if args.job in ("friction", "all"):
        job_friction(args.season or LAST_SEASON)
    if args.job in ("matchups", "all"):
        job_matchups(args.season or LAST_SEASON)
    print(f"  done in {time.time() - start:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
