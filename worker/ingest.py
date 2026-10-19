"""Courtside worker. Pulls NBA game logs into a local SQLite file and writes the small
derived artifacts the website reads.

    python ingest.py --check      can this machine reach stats.nba.com?
    python ingest.py logs         pull player game logs into courtside.db
    python ingest.py form         recompute rolling form from what is in the db
    python ingest.py export       write ../public/data/form.json for the site
    python ingest.py all          logs, form, export

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


def form_rows(con, season, min_games=5):
    """Mean and standard deviation of fantasy points per player. The sd is the point: a
    30-point average with a 14-point spread is a different asset from one with a 5-point
    spread, and a projection that reports only a mean hides what decides close weeks."""
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
        out.append({
            "name": name, "nba_id": pid, "team": team, "norm": norm_name(name),
            "g": len(fps),
            "mpg": round(sum(mins) / len(mins), 1),
            "fp_mean": round(mean, 2),
            "fp_sd": round(math.sqrt(var), 2),
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
        "scoring": WEIGHTS,
        "note": ("Fantasy points under Grace One Charlotte FBL scoring, last 25 games. "
                 "fp_sd is the game-to-game spread, not an error bar."),
        "players": rows,
    }
    with open(path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"  wrote {os.path.relpath(path)} — {len(rows)} players, "
          f"{os.path.getsize(path) // 1024} KB")
    return len(rows)


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
        "all": "logs, then form, then export"}


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
    print(f"  done in {time.time() - start:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
