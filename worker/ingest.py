"""Courtside worker — SKELETON. Pulls nothing yet.

`python ingest.py --check` is the one thing that works: it answers whether stats.nba.com will
talk to this machine at all. Every phase from 2 on depends on that, so it is the first thing
to run and the only thing written so far.

See ../docs/engine/PLAN.md for what each job does and why it is in this order.
"""
import argparse
import sys

# endpoint -> what it is for. Taken from swar/nba_api's stats/endpoints (141 of them; these
# are the ones that earn their place). Each job becomes a function in its own phase.
JOBS = {
    "game_logs": (
        2, "playergamelogs",
        "One row per player per game into player_games. The spine: form, variance and every "
        "projection downstream are derived from it.",
    ),
    "form": (
        3, "(derived)",
        "Rolling mean and standard deviation per player into player_form. The sd is the point.",
    ),
    "defense": (
        5, "leaguedashptteamdefend, leaguedashptdefend",
        "Fantasy points allowed by position, per team, into defense_vs_pos. The opponent "
        "adjustment in the projection.",
    ),
    "matchups": (
        6, "leagueseasonmatchups, matchupsrollup, boxscorematchupsv3",
        "Possession-level defender vs scorer into matchup_history. 'He shoots 31% against this "
        "man over 140 possessions' — nothing in ESPN tells you that.",
    ),
    "friction": (
        6, "playbyplayv3",
        "Technicals, flagrants and ejections where both players are named, into friction. "
        "Pairs that keep recurring are a grudge; a single incident is a coincidence.",
    ),
    "events": (
        7, "GDELT DOC API + the RSS feeds already in api/news.js",
        "Injury, suspension, legal and personal news into events. Only the availability kinds "
        "move p_play. Personal news is tagged and surfaced, never turned into a number.",
    ),
    "grade": (
        8, "(derived)",
        "Fill actual_fp on yesterday's projections and actual_win on last week's sim. Without "
        "this the model is a horoscope.",
    ),
}

NBA_PROBE = "https://stats.nba.com/stats/leaguedashptteamdefend"


def check() -> int:
    """Will stats.nba.com answer this machine? Datacenter IPs get a hang or a 403."""
    import requests

    headers = {
        "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/140.0 Safari/537.36"),
        "Referer": "https://www.nba.com/",
        "Origin": "https://www.nba.com",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "x-nba-stats-origin": "stats",
        "x-nba-stats-token": "true",
        "Connection": "keep-alive",
    }
    params = {
        "LeagueID": "00", "PerMode": "PerGame", "Season": "2026-27",
        "SeasonType": "Regular Season", "DefenseCategory": "Overall",
    }
    try:
        r = requests.get(NBA_PROBE, headers=headers, params=params, timeout=30)
    except requests.exceptions.Timeout:
        print("BLOCKED: stats.nba.com did not answer in 30 seconds.")
        print("That is how it refuses a datacenter IP. Run this on your MacBook, not a server.")
        return 1
    except requests.exceptions.RequestException as e:
        print(f"FAILED: {e}")
        return 1
    if r.status_code != 200:
        print(f"BLOCKED: stats.nba.com answered {r.status_code}.")
        return 1
    rows = r.json().get("resultSets", [{}])[0].get("rowSet", [])
    print(f"OK: stats.nba.com answered with {len(rows)} rows. The engine can be built here.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="can this machine reach stats.nba.com?")
    ap.add_argument("--job", choices=sorted(JOBS), help="not built yet")
    args = ap.parse_args()

    if args.check:
        return check()
    if args.job:
        phase, source, what = JOBS[args.job]
        print(f"{args.job}: not built. Phase {phase}.\n  source: {source}\n  does:   {what}")
        return 1

    print(__doc__)
    print("Jobs, in the order they get built:\n")
    for name, (phase, source, what) in sorted(JOBS.items(), key=lambda kv: kv[1][0]):
        print(f"  phase {phase}  {name:<10} {source}")
    print("\nRun `python ingest.py --check` first.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
