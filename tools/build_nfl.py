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
  rookies    Every NFL rookie's week-by-week points (league scoring) and snap share, from the same Sleeper weekly stats.
  bigBoard   ESPN's ranked NFL draft prospects for next spring (sports.core.api.espn.com .../draft/athletes): overall and
             position rank, school, size, the opening of ESPN's scouting note, and this college season's stats.
  college    The latest finished college football week (ESPN scoreboard, FBS): each game's passing, rushing and receiving
             leader, plus ESPN's college football headlines.

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
CFB = "https://site.api.espn.com/apis/site/v2/sports/football/college-football"
CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues"
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
rookies = {}      # player_id -> [[week, points, snap %], ...]
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
            if pl.get("years_exp") == 0:
                st = r["stats"]
                snp, tm = (st.get("def_snp"), st.get("tm_def_snp")) if g in ("DL", "LB", "DB") else (st.get("off_snp"), st.get("tm_off_snp"))
                rookies.setdefault(r["player_id"], []).append([w, round(points(st, g), 1), round(100 * snp / tm) if snp and tm else None])
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

# ---------- ESPN: next spring's draft prospects ----------
def core(url):
    return get(url.replace("http://", "https://", 1))

def stat(cats, cat, name):
    for c in cats:
        if c.get("name") == cat:
            for x in c.get("stats", []):
                if x.get("name") == name:
                    return x.get("value") or 0
    return 0

draft_year = int(season) + 1
board, schools = [], {}
try:
    lst = core(f"{CORE}/nfl/seasons/{draft_year}/draft/athletes?limit=100")
    for it in lst.get("items", []):
        x = core(it["$ref"])
        attr = {a.get("name"): a.get("value") for a in x.get("attributes", [])}
        cref = (x.get("college") or {}).get("$ref")
        if cref and cref not in schools:
            schools[cref] = core(cref).get("shortName")
        note = next((a.get("text") for a in x.get("analysis", []) if a.get("text")), "") or ""
        if len(note) > 300:                     # the opening of ESPN's note; the full one is a click away on ESPN
            cut = note[:300].rfind(". ")
            note = note[:cut + 1] if cut > 120 else note[:300].rsplit(" ", 1)[0] + "…"
        cid = ((x.get("athlete") or {}).get("$ref") or "").split("/athletes/")[-1].split("?")[0]
        stats = None
        if cid:
            try:
                cats = core(f"{CORE}/college-football/seasons/{season}/types/2/athletes/{cid}/statistics")["splits"]["categories"]
                stats = {"gp": stat(cats, "general", "gamesPlayed"),
                         "pass": [stat(cats, "passing", k) for k in ("passingYards", "passingTouchdowns", "interceptions")],
                         "rush": [stat(cats, "rushing", k) for k in ("rushingYards", "rushingTouchdowns")],
                         "rec": [stat(cats, "receiving", k) for k in ("receptions", "receivingYards", "receivingTouchdowns")],
                         "def": [stat(cats, "defensive", "totalTackles"), stat(cats, "defensive", "tacklesForLoss"), stat(cats, "defensive", "sacks"),
                                 stat(cats, "defensiveInterceptions", "interceptions"), stat(cats, "defensive", "passesDefended")]}
            except Exception:
                stats = None
        card = next((l.get("href") for l in x.get("links", []) if "playercard" in (l.get("rel") or [])), None)
        board.append({"rank": attr.get("overall"), "posRank": attr.get("rank"), "name": x.get("displayName"),
                      "pos": (x.get("position") or {}).get("abbreviation"), "school": schools.get(cref),
                      "ht": x.get("displayHeight"), "wt": x.get("displayWeight"), "note": note, "url": card, "cid": cid, "stats": stats})
        time.sleep(0.15)
    board.sort(key=lambda b: b["rank"] or 999)
except Exception as e:
    print("big board skipped:", e)

# ---------- ESPN: the latest finished college week ----------
def cfb_week(wk=None):
    return get(f"{CFB}/scoreboard?groups=80&limit=300" + (f"&week={wk}" if wk else ""))

college = {"week": None, "leaders": {}, "news": []}
try:
    sbc = cfb_week()
    cw = (sbc.get("week") or {}).get("number")
    if sum(1 for e in sbc.get("events", []) if e["status"]["type"]["state"] == "post") < 20 and cw and cw > 1:
        sbc, cw = cfb_week(cw - 1), cw - 1             # this week's games aren't done yet: use last week's
    college["week"] = cw
    for e in sbc.get("events", []):
        c = e["competitions"][0]
        if e["status"]["type"]["state"] != "post":
            continue
        teams = {t["team"]["id"]: t for t in c["competitors"]}
        for l in c.get("leaders", []):
            for x in l.get("leaders", [])[:1]:
                a, tid = x.get("athlete") or {}, (x.get("team") or {}).get("id")
                me = teams.get(tid) or {}
                opp = next((t for k, t in teams.items() if k != tid), {})
                college["leaders"].setdefault(l["name"], []).append({
                    "name": a.get("displayName"), "cid": str(a.get("id") or ""), "pos": (a.get("position") or {}).get("abbreviation"),
                    "team": (me.get("team") or {}).get("abbreviation"), "opp": (opp.get("team") or {}).get("abbreviation"),
                    "rank": (me.get("curatedRank") or {}).get("current"), "line": x.get("displayValue"), "v": x.get("value") or 0})
    for k in college["leaders"]:
        college["leaders"][k] = sorted(college["leaders"][k], key=lambda r: -r["v"])[:10]
    for a in get(f"{CFB}/news?limit=40").get("articles", []):
        cats = a.get("categories", [])
        college["news"].append({"id": a.get("id"), "at": a.get("published"), "type": a.get("type"), "head": a.get("headline", ""),
                                "dek": a.get("description", ""), "url": ((a.get("links") or {}).get("web") or {}).get("href"),
                                "athletes": [c["description"] for c in cats if c.get("type") == "athlete" and c.get("description")]})
except Exception as e:
    print("college skipped:", e)

out = {"_readme": "Built by tools/build_nfl.py; see that file for sources. Don't edit by hand.",
       "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
       "season": season, "week": week, "dvpThrough": week - 1,
       "scoring": "league" if scoring else "sleeper-default",
       "news": news, "games": games, "byes": byes, "injuries": injuries,
       "dvp": dvp, "proj": proj, "trending": trending,
       "rookies": rookies, "draftYear": draft_year, "bigBoard": board, "college": college}
if len(dvp) < 30 or not games:
    sys.exit(f"Unexpected data (dvp teams {len(dvp)}, games {len(games)}); not overwriting {OUT}")
json.dump(out, open(OUT, "w"), separators=(",", ":"))
print(f"{OUT}: week {week}, {len(news)} stories, {len(games)} games, {len(injuries)} injuries, {len(dvp)} defenses, {len(proj)} projections, {len(rookies)} rookies, {len(board)} prospects, college week {college['week']}")
