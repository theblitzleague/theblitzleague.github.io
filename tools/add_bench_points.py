#!/usr/bin/env python3
"""Add Sleeper's `players_points` field (every rostered player's score, bench included) to the sample matchups.

Real Sleeper matchups carry players_points; the original sample only had starters_points. Lineup IQ,
Bench Warmer and the GM Index need bench scores, so this fills them in. INVENTED placeholder numbers,
like every other sample score. Starters keep exactly their existing starters_points, so no game result changes.
Uses its own random seed, so it never disturbs tools/build_sample.py's numbers.

Usage: python3 tools/add_bench_points.py   (run after tools/build_sample.py; safe to re-run)"""
import json, os, random

D = os.path.join(os.path.dirname(__file__), "..", "data", "sample")
matchups = json.load(open(os.path.join(D, "matchups.json")))
players = json.load(open(os.path.join(D, "players.json")))
state = json.load(open(os.path.join(D, "state.json")))
rng = random.Random(4471)
MEAN = {"QB": 15, "RB": 8.5, "WR": 8.5, "TE": 5.5, "K": 6.5, "DL": 5, "LB": 7, "DB": 6}      # bench players: below starter level
IDP = {"DE": "DL", "DT": "DL", "NT": "DL", "ILB": "LB", "OLB": "LB", "CB": "DB", "S": "DB", "SS": "DB", "FS": "DB"}
def grp(p):
    if p["position"] in MEAN:
        return p["position"]
    return next((f for f in p.get("fantasy_positions") or [] if f in ("DL", "LB", "DB")), IDP.get(p["position"]))

for wk, rows in matchups.items():
    w = int(wk)
    for row in rows:
        pp = {}
        if w <= state["week"]:
            for k, v in zip(row["starters"], row["starters_points"]):
                pp[k] = v
            for k in row["players"]:
                if k in pp:
                    continue
                played = w < state["week"] or rng.random() < 0.5          # week in progress: about half have played
                pos = grp(players[k])
                sd = 5.5 if pos in ("QB", "RB", "WR", "TE") else 3.5
                pp[k] = round(max(0, rng.gauss(MEAN.get(pos, 6), sd)), 2) if played else 0
        row["players_points"] = pp
        assert abs(sum(row["players_points"].get(k, 0) for k in row["starters"]) - row["points"]) < 0.02 or w > state["week"]

json.dump(matchups, open(os.path.join(D, "matchups.json"), "w"), indent=1)
print("players_points added for weeks 1 -", state["week"])
