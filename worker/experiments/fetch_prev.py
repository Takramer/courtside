"""Pull earlier seasons into worker/experiments/prev.db, so a parameter chosen on 2025-26
can be checked on a season it has never seen. Same endpoint and scoring as ../ingest.py;
the main courtside.db is not touched.

    python3 fetch_prev.py 2024-25 2023-24
"""
import os
import sqlite3
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
import ingest  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prev.db")


def main(seasons):
    con = sqlite3.connect(OUT)
    con.executescript(ingest.SCHEMA)
    for season in seasons:
        rows = ingest.rows_of(ingest.get("playergamelogs", {
            "Season": season, "SeasonType": "Regular Season", "LeagueID": "00",
            "PerMode": "Totals", "MeasureType": "Base"}))
        with con:
            for r in rows:
                con.execute(
                    "insert or replace into player_games values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (r["PLAYER_ID"], r["GAME_ID"], season, (r["GAME_DATE"] or "")[:10],
                     r.get("TEAM_ABBREVIATION"), r.get("MATCHUP"),
                     r["MIN"], r["PTS"], r["REB"], r["AST"], r["STL"], r["BLK"], r["TOV"],
                     r["FGM"], r["FGA"], r["FTM"], r["FTA"], r["FG3M"], ingest.fantasy_points(r)))
        print(f"  {season}: {len(rows)} rows")
        time.sleep(2)
    assert con.execute("select count(*) from player_games").fetchone()[0] > 0


if __name__ == "__main__":
    main(sys.argv[1:] or ["2024-25"])
