#!/usr/bin/env python3
"""Build data/players.json: a trimmed copy of Sleeper's NFL player database for live mode.

Sleeper's full database (GET https://api.sleeper.app/v1/players/nfl) is ~15 MB, and Sleeper asks that it be pulled
at most once a day, so visitors' browsers must never fetch it. Run this once a day (cron or Task Scheduler) and
publish the result with the site.

Keeps every fantasy-relevant position (offense, kicker, team defense and IDP) for players currently on an NFL team, plus anyone on a Blitz League roster (so a released player on someone's bench still has a name).

Usage: python3 tools/build_players.py [--from saved-players.json]   (no args = download from Sleeper)"""
import json, os, sys, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "players.json")
API = "https://api.sleeper.app/v1"
POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"}         # Sleeper fantasy_positions
FIELDS = ("full_name", "position", "fantasy_positions", "team", "number", "age", "years_exp",
          "injury_status", "injury_body_part", "college", "height", "weight")        # only what the site reads

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "blitz-league-hub/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

if "--from" in sys.argv:
    players = json.load(open(sys.argv[sys.argv.index("--from") + 1]))
else:
    players = get(f"{API}/players/nfl")
if not isinstance(players, dict) or len(players) < 1000:
    sys.exit(f"Unexpected player database ({type(players).__name__}, {len(players)} entries); not overwriting {OUT}")

rostered = set()
league = json.load(open(os.path.join(ROOT, "data", "league.json")))
if league.get("sleeperLeagueId"):
    for r in get(f"{API}/league/{league['sleeperLeagueId']}/rosters"):
        rostered.update((r.get("players") or []) + (r.get("taxi") or []) + (r.get("reserve") or []))

def keep(k, p):
    if k in rostered:
        return True
    fp = set(p.get("fantasy_positions") or [p.get("position")])
    return bool(fp & POSITIONS) and bool(p.get("team"))                  # on an NFL roster right now

slim = {}
for k, p in players.items():
    if keep(k, p):
        e = {f: p.get(f) for f in FIELDS if p.get(f) is not None}
        if p.get("position") == "DEF" and not e.get("full_name"):                # team defenses have no full_name
            e["full_name"] = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip() or k
        slim[k] = e

missing = rostered - set(slim)
if missing:
    sys.exit(f"{len(missing)} rostered player IDs aren't in Sleeper's database: {sorted(missing)[:10]}")
tmp = OUT + ".tmp"
json.dump(slim, open(tmp, "w"), separators=(",", ":"))
os.replace(tmp, OUT)
print(f"wrote {OUT}: {len(slim)} players ({os.path.getsize(OUT) // 1024} KB), {len(rostered)} rostered")
