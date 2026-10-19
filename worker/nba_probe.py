"""Which stats.nba.com endpoints actually answer this machine, and how fast.

The first probe showed the host is reachable (HTTP 500 in 0.8s, not a hang) but that one
endpoint hung for 30 seconds. So the question is not "blocked or not" — it is which endpoints
answer, with which season, and how hard they throttle. Run:  python nba_probe.py
"""
import sys
import time

import requests

LAST = "2025-26"   # finished season: there is definitely data
THIS = "2026-27"   # current season: opens 2026-10-21

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"),
    "Referer": "https://www.nba.com/", "Origin": "https://www.nba.com",
    "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive", "x-nba-stats-origin": "stats", "x-nba-stats-token": "true",
    "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
}

# The endpoints the engine needs, in the order the phases need them.
CALLS = [
    ("playergamelogs (last season)", "playergamelogs",
     {"Season": LAST, "SeasonType": "Regular Season", "LeagueID": "00"}),
    ("commonallplayers", "commonallplayers",
     {"Season": THIS, "LeagueID": "00", "IsOnlyCurrentSeason": "1"}),
    ("leaguedashptteamdefend (last season)", "leaguedashptteamdefend",
     {"Season": LAST, "SeasonType": "Regular Season", "LeagueID": "00",
      "PerMode": "PerGame", "DefenseCategory": "Overall"}),
    ("leagueseasonmatchups (last season)", "leagueseasonmatchups",
     {"Season": LAST, "SeasonType": "Regular Season", "LeagueID": "00", "PerMode": "Totals"}),
    ("leaguedashplayerstats (this season)", "leaguedashplayerstats",
     {"Season": THIS, "SeasonType": "Regular Season", "LeagueID": "00",
      "PerMode": "PerGame", "MeasureType": "Base", "PaceAdjust": "N", "PlusMinus": "N",
      "Rank": "N", "Month": "0", "OpponentTeamID": "0", "Period": "0", "LastNGames": "0"}),
]


def call(path, params, timeout=30):
    r = requests.get(f"https://stats.nba.com/stats/{path}", params=params,
                     headers=HEADERS, timeout=timeout)
    if r.status_code != 200:
        return f"HTTP {r.status_code}", 0
    sets = r.json().get("resultSets") or r.json().get("resultSet") or []
    rows = sum(len(s.get("rowSet", [])) for s in (sets if isinstance(sets, list) else [sets]))
    return "OK", rows


def main():
    ok = 0
    for label, path, params in CALLS:
        start = time.time()
        try:
            status, rows = call(path, params)
            took = time.time() - start
            if status == "OK":
                ok += 1
                print(f"  OK    {label:<42} {took:5.1f}s  {rows} rows")
            else:
                print(f"  --    {label:<42} {took:5.1f}s  {status}")
        except requests.exceptions.Timeout:
            print(f"  HANG  {label:<42} {time.time() - start:5.1f}s  no answer in 30s")
        except Exception as e:
            print(f"  FAIL  {label:<42} {time.time() - start:5.1f}s  {type(e).__name__}: {str(e)[:60]}")
        time.sleep(2)  # be a good citizen; NBA throttles bursts

    print()
    if ok == len(CALLS):
        print("VERDICT: every endpoint answers. Build the worker here, nightly, on this Mac.")
    elif ok:
        print(f"VERDICT: {ok} of {len(CALLS)} answer. Reachable but picky — retry with backoff,")
        print("         and treat a hang as 'try again later', not 'blocked'.")
    else:
        print("VERDICT: nothing answers. Needs a proxy or a different source.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
