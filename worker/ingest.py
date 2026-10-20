"""Courtside worker. Pulls NBA game logs into a local SQLite file and writes the small
derived artifacts the website reads.

    python ingest.py --check      can this machine reach stats.nba.com?
    python ingest.py logs         pull player game logs into courtside.db
    python ingest.py form         recompute rolling form from what is in the db
    python ingest.py export       write ../public/data/form.json for the site
    python ingest.py dvp          defence by position -> ../public/data/dvp.json
    python ingest.py all          logs, form, export, dvp

Runs on the laptop, not a server: NBA refuses datacenter IPs. See ../docs/engine/SOURCES.md.
Nothing here touches ESPN — the browser does that, with credentials that stay on your devices.
"""
import argparse
import json
import math
import os
import sqlite3
import sys
import time
import unicodedata
from datetime import datetime, timezone

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "courtside.db")
DATA = os.path.join(HERE, os.pardir, "public", "data")  # Vite serves public/ at the site root

THIS_SEASON = "2026-27"   # the 2026-27 NBA season; ESPN calls it 2027 in api/players.js
LAST_SEASON = "2025-26"

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

create table if not exists runs (
  job text not null, season text not null, at text not null, rows integer not null
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
    con = db()
    total = 0
    for season in seasons:
        print(f"  {season}: asking for every player game log…")
        payload = get("playergamelogs", {
            "Season": season, "SeasonType": "Regular Season", "LeagueID": "00",
            "PerMode": "Totals", "MeasureType": "Base",
        })
        rows = rows_of(payload)
        print(f"  {season}: {len(rows)} rows")
        with con:
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


def team_game_counts(con, season):
    """How many games each team actually played. The denominator for availability."""
    return {team: n for team, n in con.execute(
        "select team, count(distinct game_id) from player_games where season = ?"
        " group by team", (season,))}


def form_rows(con, season, min_games=5):
    """Mean and standard deviation of fantasy points per player, plus how often he suits up.

    The sd is the point: a 30-point average with a 14-point spread is a different asset from
    one with a 5-point spread, and a projection that reports only a mean hides what decides
    close weeks. Availability is the other half — a 40-point player who plays 55 games is
    worth less over a week than a 34-point player who plays 78."""
    team_games = team_game_counts(con, season)
    out = []
    for pid, name, team in con.execute(
            "select p.player_id, p.name, p.team from players p"
            " where exists (select 1 from player_games g where g.player_id = p.player_id"
            "              and g.season = ?)", (season,)):
        fps = [r[0] for r in con.execute(
            "select fp from player_games where player_id = ? and season = ?"
            " order by game_date desc limit 25", (pid, season))]
        mins = [r[0] or 0 for r in con.execute(
            "select min from player_games where player_id = ? and season = ?"
            " order by game_date desc limit 25", (pid, season))]
        if len(fps) < min_games:
            continue
        mean = sum(fps) / len(fps)
        var = sum((x - mean) ** 2 for x in fps) / (len(fps) - 1)
        played = con.execute("select count(*) from player_games where player_id = ? and season = ?",
                             (pid, season)).fetchone()[0]
        possible = team_games.get(team, 0)
        out.append({
            "name": name, "nba_id": pid, "team": team, "norm": norm_name(name),
            "g": len(fps),
            "mpg": round(sum(mins) / len(mins), 1),
            "fp_mean": round(mean, 2),
            "fp_sd": round(math.sqrt(var), 2),
            # Share of his team's games he actually appeared in. Traded players look worse
            # than they are here, which is why it is a prior the injury report overrides.
            "avail": round(min(1.0, played / possible), 3) if possible else None,
        })
    out.sort(key=lambda r: -r["fp_mean"])
    return out


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
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
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
        job_positions(season)
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
        "all": "logs, then form, then export, then dvp"}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("job", nargs="?", choices=sorted(JOBS), help="; ".join(
        f"{k}: {v}" for k, v in JOBS.items()))
    ap.add_argument("--check", action="store_true", help="can this machine reach stats.nba.com?")
    ap.add_argument("--season", default=None, help="one season, e.g. 2025-26")
    args = ap.parse_args()

    if args.check:
        return check()
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
    print(f"  done in {time.time() - start:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
