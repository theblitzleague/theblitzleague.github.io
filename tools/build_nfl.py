#!/usr/bin/env python3
"""Build data/nfl.json: the real-NFL side of the Blitz Network (js/nfl.js, home page and network.html).

What it holds, and where each part comes from:
  news       ESPN's NFL headlines (site.api.espn.com .../nfl/news). Headline, summary, link, byline, the athletes and
             teams ESPN tagged. The site links out to ESPN for the story; it never copies article text.
  games      This NFL week's slate from ESPN's scoreboard: kickoff, status, TV, records, score, line and total.
  byes       NFL teams on bye this week.
  injuries   ESPN's injury report: status and ESPN's one-line note, by player name and NFL team.
  dvp        Points each NFL team has allowed per game to each fantasy position this season, scored with the Blitz
             League's own scoring settings, from Sleeper's weekly stats (api.sleeper.com/stats/nfl/<season>/<week>).
             For DL, LB and DB it is the points those defenders scored against that team's offense.
  proj       This week's projection for every player Sleeper projects (api.sleeper.com/projections/...), in league
             scoring, with the NFL opponent.
  trending   Sleeper's most-added and most-dropped players over the last 24 hours.

js/nfl.js asks ESPN and Sleeper for news, games, injuries and trending directly when it can (they allow it), and
uses this snapshot when it can't (the claude.ai preview blocks outside requests) or when a call fails. dvp and proj
always come from here, since building them takes ~20 MB of downloads. Run it daily with tools/build_players.py.

The api.sleeper.com and site.api.espn.com endpoints are the apps' own, not documented APIs, and could change.

Usage: python3 tools/build_nfl.py [--scoring LEAGUE_ID]
  Scoring comes from league.json sleeperLeagueId, else --scoring, else Sleeper's PPR + IDP defaults."""
import json, os, sys, time, urllib.request, datetime

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "nfl.json")
ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
SLEEPER = "https://api.sleeper.app/v1"
STATS = "https://api.sleeper.com/stats/nfl/{season}/{week}?season_type=regular"
PROJ = "https://api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular"
ABBR = {"WSH": "WAS"}                       # ESPN abbreviation -> Sleeper's
GROUP = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "K": "K",
         "DE": "DL", "DT": "DL", "DL": "DL", "NT": "DL", "LB": "LB", "OLB": "LB", "ILB": "LB", "MLB": "LB",
         "CB": "DB", "S": "DB", "SS": "DB", "FS": "DB", "DB": "DB"}
POS = ["QB", "RB", "WR", "TE", "K", "DL", "LB", "DB"]

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "blitz-league-hub/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

def ab(a):
    return ABBR.get(a, a)

league = json.load(open(os.path.join(ROOT, "data", "league.json")))
lid = league.get("sleeperLeagueId") or (sys.argv[sys.argv.index("--scoring") + 1] if "--scoring" in sys.argv else None)
scoring = (get(f"{SLEEPER}/league/{lid}").get("scoring_settings") or {}) if lid else None

def points(stats, pos):
    if scoring:
        return sum(v * stats[k] for k, v in scoring.items() if isinstance(stats.get(k), (int, float)))
    return stats.get("pts_idp" if pos in ("DL", "LB", "DB") else "pts_ppr") or 0

def group(player):
    for p in [player.get("position")] + (player.get("fantasy_positions") or []):
        if p in GROUP:
            return GROUP[p]
    return None

state = get(f"{SLEEPER}/state/nfl")
season, week = state["season"], int(state["week"])

# ---------- ESPN: scoreboard, news, injuries ----------
sb = get(f"{ESPN}/scoreboard")
team_by_id = {}
games = []
for e in sb.get("events", []):
    c = e["competitions"][0]
    side = {}
    for t in c["competitors"]:
        tm = t["team"]
        team_by_id[tm["id"]] = ab(tm["abbreviation"])
        rec = next((r["summary"] for r in t.get("records", []) if r.get("type") == "total"), "")
        side[t["homeAway"]] = {"abbr": ab(tm["abbreviation"]), "name": tm.get("displayName", ""), "short": tm.get("shortDisplayName", ""),
                               "rec": rec, "score": t.get("score"), "winner": bool(t.get("winner"))}
    odds = (c.get("odds") or [{}])[0] or {}
    st = e["status"]["type"]
    recap = next((h.get("shortLinkText") for h in c.get("headlines", []) if h.get("shortLinkText")), None)
    games.append({"id": e["id"], "at": e["date"], "state": st.get("state"), "detail": st.get("shortDetail"),
                  "net": ", ".join(n for b in c.get("broadcasts", []) for n in b.get("names", [])),
                  "home": side.get("home"), "away": side.get("away"), "neutral": bool(c.get("neutralSite")),
                  "venue": (c.get("venue") or {}).get("fullName"), "line": odds.get("details"), "ou": odds.get("overUnder"),
                  "recap": recap})
byes = []
for t in (sb.get("week") or {}).get("teamsOnBye", []):
    team_by_id[t["id"]] = ab(t["abbreviation"]); byes.append(ab(t["abbreviation"]))
if len(team_by_id) < 32:                      # fill in any team not on this week's slate (news can tag them)
    for t in get(f"{ESPN}/teams")["sports"][0]["leagues"][0]["teams"]:
        team_by_id.setdefault(t["team"]["id"], ab(t["team"]["abbreviation"]))

news = []
for a in get(f"{ESPN}/news?limit=50").get("articles", []):
    cats = a.get("categories", [])
    news.append({"id": a.get("id"), "at": a.get("published"), "type": a.get("type"), "head": a.get("headline", ""),
                 "dek": a.get("description", ""), "url": ((a.get("links") or {}).get("web") or {}).get("href"),
                 "byline": a.get("byline"), "premium": bool(a.get("premium")),
                 "athletes": [c["description"] for c in cats if c.get("type") == "athlete" and c.get("description")],
                 "teams": sorted({team_by_id[str(c.get("teamId"))] for c in cats if c.get("type") == "team" and str(c.get("teamId")) in team_by_id})})

injuries = []
inj = get(f"{ESPN}/injuries")
for team in inj.get("injuries", []):
    for x in team.get("injuries", []):
        ath = x.get("athlete") or {}
        if x.get("status") in (None, "Active"):          # ESPN lists cleared players too; keep only real designations
            continue
        tm = ab(((ath.get("team") or {}).get("abbreviation")) or "") or None
        injuries.append({"name": ath.get("displayName"), "team": tm, "pos": ((ath.get("position") or {}).get("abbreviation")),
                         "status": x.get("status"), "note": x.get("shortComment"), "at": x.get("date")})

# ---------- Sleeper: points allowed by position, projections, trending ----------
allowed = {}      # team -> pos -> points
played = {}       # team -> set of game ids
for w in range(1, week):
    for r in get(STATS.format(season=season, week=w)):
        opp, pl = r.get("opponent"), r.get("player") or {}
        if not opp or not r.get("game_id"):
            continue
        played.setdefault(opp, set()).add(r["game_id"])
        g = group(pl)
        if g and (r.get("stats") or {}).get("gp"):
            allowed.setdefault(opp, {}).setdefault(g, 0.0)
            allowed[opp][g] += points(r["stats"], g)
    time.sleep(0.5)
dvp = {}
for t, gids in played.items():
    n = len(gids)
    dvp[t] = {"g": n, **{p: round(allowed.get(t, {}).get(p, 0.0) / n, 1) for p in POS}}
for p in POS:                                  # rank 1 = gives up the most (the easiest matchup)
    for i, t in enumerate(sorted(dvp, key=lambda t: -dvp[t][p])):
        dvp[t].setdefault("rank", {})[p] = i + 1

proj = {}
for r in get(PROJ.format(season=season, week=week)):
    pl, s = r.get("player") or {}, r.get("stats") or {}
    g = group(pl)
    if not g or not r.get("opponent"):
        continue
    v = round(points(s, g), 1)
    if v >= 1:
        proj[r["player_id"]] = [v, r["opponent"], r.get("team")]

trending = {k: get(f"{SLEEPER}/players/nfl/trending/{k}?lookback_hours=24&limit=25") for k in ("add", "drop")}

out = {"_readme": "Built by tools/build_nfl.py; see that file for sources. Don't edit by hand.",
       "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
       "season": season, "week": week, "dvpThrough": week - 1,
       "scoring": "league" if scoring else "sleeper-default",
       "news": news, "games": games, "byes": byes, "injuries": injuries,
       "dvp": dvp, "proj": proj, "trending": trending}
if len(dvp) < 30 or not games:
    sys.exit(f"Unexpected data (dvp teams {len(dvp)}, games {len(games)}); not overwriting {OUT}")
json.dump(out, open(OUT, "w"), separators=(",", ":"))
print(f"{OUT}: week {week}, {len(news)} stories, {len(games)} games, {len(injuries)} injuries, {len(dvp)} defenses, {len(proj)} projections")
