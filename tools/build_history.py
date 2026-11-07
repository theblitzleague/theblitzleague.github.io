#!/usr/bin/env python3
"""Build data/history.json: one entry per COMPLETED season, from Sleeper. Run once after each championship.

Walks the league's chain (each Sleeper dynasty season is a new league that points at the last one through
previous_league_id) and records every season Sleeper marks complete:
  - per team: the GM's Sleeper user ID (the key that lets titles follow a GM between franchises), their display
    name, division, wins / losses / ties, points for and against;
  - champion and runner-up: the winner and loser of the winners bracket's 1st-place game (p == 1); third: the winner
    of its 3rd-place game (p == 3);
  - division winners: best record in each division, ties broken by points for (the site's standings rule);
  - weeklyHigh: each regular-season week's top score (from that week's matchups; ties list every roster);
  - pointsLeader: most regular-season points (summed from the same matchups, so playoff games never count);
  - prizes: a copy of league.json's prize amounts the first time a season is written, so later changes don't rewrite it;
  - playerAwards: Offensive (QB/RB/WR/TE), Defensive (DL/LB/DB) and Rookie of the Year, each the player with the most
    regular-season points as a Blitz starter (the Awards page's rule), as [{player, roster, points}] (a tie lists all).
    Pickup and Trade of the Year are judgment calls, entered by hand as {player, roster} lists and kept on reruns.
gmOfYear (the league vote, a roster_id) is entered by hand and kept on every rerun, as is an existing prizes copy.
Seasons already in the file that Sleeper doesn't return (entered by hand) are kept.

Usage: python3 tools/build_history.py [--league ID] [--out PATH]   (defaults: league.json's sleeperLeagueId, data/history.json)"""
import json, os, sys, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
API = "https://api.sleeper.app/v1"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "blitz-league-hub/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

league_cfg = json.load(open(os.path.join(ROOT, "data", "league.json")))
players = json.load(open(os.path.join(ROOT, "data", "players.json")))   # positions and experience for the player awards
OFF, DEF = {"QB", "RB", "WR", "TE"}, {"DL", "LB", "DB", "DE", "DT", "NT", "OLB", "ILB", "MLB", "CB", "S", "SS", "FS"}
def groups(pid):
    p = players.get(str(pid)) or {}
    return {p.get("position")} | set(p.get("fantasy_positions") or [])
now_season = int(get(f"{API}/state/nfl").get("season") or 0)
lid = arg("--league", league_cfg.get("sleeperLeagueId"))
out = arg("--out", os.path.join(ROOT, "data", "history.json"))
if not lid:
    sys.exit("No league ID: set sleeperLeagueId in data/league.json or pass --league")

doc = json.load(open(out)) if os.path.exists(out) else {"seasons": []}
seasons = {s["season"]: s for s in doc.get("seasons", [])}
found = []
while lid and lid != "0":
    lg = get(f"{API}/league/{lid}")
    if lg.get("status") == "complete":
        rosters, users = get(f"{API}/league/{lid}/rosters"), get(f"{API}/league/{lid}/users")
        bracket = get(f"{API}/league/{lid}/winners_bracket") or []
        name = {u["user_id"]: u.get("display_name") for u in users}
        teams = {}
        for r in rosters:
            s = r.get("settings") or {}
            teams[str(r["roster_id"])] = {
                "gm": r.get("owner_id"), "gmName": name.get(r.get("owner_id")), "division": s.get("division"),
                "wins": s.get("wins", 0), "losses": s.get("losses", 0), "ties": s.get("ties", 0),
                "pf": round((s.get("fpts") or 0) + (s.get("fpts_decimal") or 0) / 100, 2),
                "pa": round((s.get("fpts_against") or 0) + (s.get("fpts_against_decimal") or 0) / 100, 2)}
        final = next((m for m in bracket if m.get("p") == 1), None)
        if not final or not final.get("w"):
            sys.exit(f"{lg['season']}: Sleeper says complete but the winners bracket has no decided 1st-place game; not guessing a champion")
        divs = {}
        for rid, e in teams.items():
            if e["division"] is None:
                continue
            best = divs.get(e["division"])
            if best is None or (e["wins"], e["pf"]) > (teams[best]["wins"], teams[best]["pf"]):
                divs[e["division"]] = rid
        reg_weeks = int((lg.get("settings") or {}).get("playoff_week_start") or 15) - 1
        weekly, season_pts, starts = [], {}, {}     # starts: player -> [points, roster of his latest start]
        for w in range(1, reg_weeks + 1):
            rows = [m for m in (get(f"{API}/league/{lid}/matchups/{w}") or []) if m.get("matchup_id") is not None]
            if not rows:
                continue
            for m in rows:
                season_pts[m["roster_id"]] = season_pts.get(m["roster_id"], 0) + (m.get("points") or 0)
                for pid, pts in zip(m.get("starters") or [], m.get("starters_points") or []):
                    if pid and pid != "0":
                        s = starts.setdefault(pid, [0.0, m["roster_id"]]); s[0] += pts or 0; s[1] = m["roster_id"]
            hi = max(m.get("points") or 0 for m in rows)
            weekly.append({"week": w, "points": round(hi, 2), "rosters": sorted(m["roster_id"] for m in rows if (m.get("points") or 0) == hi)})
        top = max(season_pts.values()) if season_pts else None
        old = seasons.get(lg["season"], {})
        third = next((m for m in bracket if m.get("p") == 3), None)
        def best(keep):
            pool = {pid: v for pid, v in starts.items() if keep(pid)}
            if not pool:
                return []
            hi = max(v[0] for v in pool.values())
            return [{"player": pid, "roster": v[1], "points": round(v[0], 2)} for pid, v in sorted(pool.items()) if v[0] == hi]
        yrs = int(lg["season"])
        rookie = lambda pid: (players.get(str(pid)) or {}).get("years_exp") == now_season - yrs
        hand = old.get("playerAwards") or {}
        awards = {"opoy": best(lambda pid: bool(groups(pid) & OFF) and not groups(pid) & DEF), "dpoy": best(lambda pid: bool(groups(pid) & DEF)),
                  "roy": best(rookie), "pickup": hand.get("pickup") or [], "trade": hand.get("trade") or []}
        seasons[lg["season"]] = {"season": lg["season"], "leagueId": lid, "champion": final["w"], "runnerUp": final.get("l"),
                                 "third": third.get("w") if third else None, "playerAwards": awards,
                                 "divisionWinners": sorted(int(r) for r in divs.values()),
                                 "weeklyHigh": weekly, "pointsLeader": sorted(r for r, v in season_pts.items() if v == top) if top is not None else [],
                                 "gmOfYear": old.get("gmOfYear"), "prizes": old.get("prizes") or league_cfg.get("prizes"), "teams": teams}
        found.append(lg["season"])
    lid = lg.get("previous_league_id")

doc["seasons"] = [seasons[k] for k in sorted(seasons)]
json.dump(doc, open(out + ".tmp", "w"), indent=1, ensure_ascii=False)
os.replace(out + ".tmp", out)
print(f"{out}: {len(doc['seasons'])} completed season(s); from Sleeper this run: {found or 'none'}")
