#!/usr/bin/env python3
"""Build the placeholder Sleeper-shaped data in data/sample/.

Usage: python3 tools/build_sample.py /path/to/sleeper-players-nfl.json

Player info (names, teams, ages, injury status) is REAL, pulled from Sleeper's
player database. Rosters, scores, trades and picks are INVENTED placeholders so
the pages have something to show before the league exists. Every player is
looked up by name; the script fails loudly rather than guessing an ID.
"""
import json, random, sys, os
from datetime import datetime, timezone, timedelta

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "sample")
players = json.load(open(sys.argv[1]))
FANTASY = ("QB", "RB", "WR", "TE")
IDP_MAP = {"DE": "DL", "DT": "DL", "NT": "DL", "ILB": "LB", "OLB": "LB", "CB": "DB", "S": "DB", "SS": "DB", "FS": "DB"}
def grp(p):
    """The lineup group a player fills: offense and K as listed, defenders as DL / LB / DB (Sleeper lists DE, CB, ...)."""
    pos = p.get("position")
    if pos in FANTASY or pos == "K":
        return pos
    for f in p.get("fantasy_positions") or []:
        if f in ("DL", "LB", "DB"):
            return f
    return IDP_MAP.get(pos)
GROUPS = FANTASY + ("K", "DL", "LB", "DB")

def find(name, pos=None):
    hits = [(k, p) for k, p in players.items()
            if p.get("full_name") == name and p.get("active")
            and p.get("position") in FANTASY and (pos is None or p.get("position") == pos)]
    if len(hits) != 1:
        sys.exit(f"Could not resolve '{name}' ({len(hits)} matches)")
    return hits[0][0]

used = set()
def ids(names):
    out = [find(n, "QB" if n == "Josh Allen" else None) for n in names]
    used.update(out)
    return out

# Roster 1: Wyoming (commissioner's franchise)
qb = ids(["Josh Allen", "Bo Nix", "Cam Ward"])
rb = ids(["Bijan Robinson", "Ashton Jeanty", "TreVeyon Henderson", "Quinshon Judkins", "Kyren Williams"])
wr = ids(["Ja'Marr Chase", "Malik Nabers", "Tetairoa McMillan", "Luther Burden III", "Rome Odunze"])
te = ids(["Brock Bowers", "Colston Loveland"])
maye = ids(["Drake Maye"])[0]          # traded away to Brooklyn

def ranked(pred, n):
    pool = sorted((p.get("search_rank") or 99999, k) for k, p in players.items()
                  if k not in used and p.get("active") and p.get("team")
                  and grp(p) in GROUPS and pred(p))
    picks = [k for _, k in pool[:n]]
    used.update(picks)
    return picks

taxi = ranked(lambda p: p.get("years_exp") == 0 and p.get("position") in FANTASY, 3)
k_ = ranked(lambda p: grp(p) == "K", 1)
dl_ = ranked(lambda p: grp(p) == "DL" and p.get("injury_status") not in ("Out", "IR", "PUP", "Sus"), 2)
lb_ = ranked(lambda p: grp(p) == "LB" and p.get("injury_status") not in ("Out", "IR", "PUP", "Sus"), 2)
db_ = ranked(lambda p: grp(p) == "DB" and p.get("injury_status") not in ("Out", "IR", "PUP", "Sus"), 2)
fa_adds = ranked(lambda p: p.get("position") in ("RB", "WR") and 160 <= (p.get("search_rank") or 0) <= 400, 2)
fa_drops = ranked(lambda p: p.get("position") in ("RB", "WR", "TE") and 450 <= (p.get("search_rank") or 0) <= 900, 2)

# QB RB RB WR WR TE FLEX FLEX SF K DL LB DB IDP_FLEX (the real Blitz League lineup, from Sleeper 2026-11-04)
starters = [qb[0], rb[0], rb[1], wr[0], wr[1], te[0], rb[3], wr[2], qb[1], k_[0], dl_[0], lb_[0], db_[0], lb_[1]]
wyo_players = qb + rb + wr + te + k_ + dl_ + lb_ + db_ + taxi + fa_adds
reserve = [rb[2]] if players[rb[2]].get("injury_status") in ("Out", "IR") else []

rng = random.Random(2026)
N, WEEKS, PLAYED = 12, 14, 8

# Round-robin (circle method) for 11 weeks, then repeat weeks 1-3.
teams = list(range(1, N + 1))
rr = []
for r in range(N - 1):
    pairs = [(teams[i], teams[N - 1 - i]) for i in range(N // 2)]
    rr.append(pairs)
    teams = [teams[0]] + [teams[-1]] + teams[1:-1]
rng0 = random.Random(9)
rng0.shuffle(rr)
sched = rr + rr[:WEEKS - len(rr)]

# ---- Rosters for the other 11 teams: a snake draft over Sleeper's search_rank (real players, invented teams) ----
NEED = {"QB": 3, "RB": 5, "WR": 6, "TE": 2, "K": 1, "DL": 2, "LB": 2, "DB": 3}   # 14 starters + 10 bench
team_players = {rid: [] for rid in range(2, N + 1)}
team_players[9].append(maye)
pool = sorted((p.get("search_rank") or 99999, k) for k, p in players.items()
              if k not in used and k != maye and p.get("active") and p.get("team") and grp(p) in GROUPS)
order = list(range(2, N + 1))
def need_left(rid, pos):
    return NEED[pos] - sum(1 for x in team_players[rid] if grp(players[x]) == pos)
avail = [k for _, k in pool]
rnd = 0
while any(need_left(r, pos) > 0 for r in order for pos in NEED):
    for rid in (order if rnd % 2 == 0 else order[::-1]):
        if all(need_left(rid, pos) <= 0 for pos in NEED):
            continue
        k = next((k for k in avail if need_left(rid, grp(players[k])) > 0
                  and not (grp(players[k]) == "K" and players[k].get("injury_status"))), None)   # one kicker each: a healthy one
        if k is None:
            sys.exit(f"ran out of players while filling roster {rid}")
        team_players[rid].append(k); used.add(k); avail.remove(k)
    rnd += 1

SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX", "K", "DL", "LB", "DB", "IDP_FLEX"]
ELIG = {"QB": {"QB"}, "RB": {"RB"}, "WR": {"WR"}, "TE": {"TE"}, "FLEX": {"RB", "WR", "TE"}, "SUPER_FLEX": {"QB", "RB", "WR", "TE"},
        "K": {"K"}, "DL": {"DL"}, "LB": {"LB"}, "DB": {"DB"}, "IDP_FLEX": {"DL", "LB", "DB"}}
rank = lambda k: players[k].get("search_rank") or 99999
hurt = lambda k: players[k].get("injury_status") in ("Out", "IR", "PUP", "Sus")
def lineup(ids):
    left, out = sorted(ids, key=lambda k: (hurt(k), rank(k))), []        # healthy players start first
    for slot in SLOTS:
        pick = next(k for k in left if grp(players[k]) in ELIG[slot]); out.append(pick); left.remove(pick)
    return out
team_starters = {rid: lineup(team_players[rid]) for rid in team_players}
team_players[1] = wyo_players; team_starters[1] = starters

# Weekly points: position mean scaled by how highly Sleeper ranks the player, plus noise. Week 9 is "in progress":
# about half the starters have played.
MEAN = {"QB": 20, "RB": 13, "WR": 13, "TE": 9, "K": 8, "DL": 7, "LB": 9.5, "DB": 8}   # IDP: 1 per solo tackle, 4 per sack
def score(k):
    q = min(1.3, max(0.7, 1.3 - rank(k) / 260))
    sd = 6.5 if grp(players[k]) in FANTASY else 4
    return round(max(0, rng.gauss(MEAN[grp(players[k])] * q, sd)), 2)
matchups = {}
for w, pairs in enumerate(sched, start=1):
    rows = []
    for mid, (a, b) in enumerate(pairs, start=1):
        for rid in (a, b):
            st = team_starters[rid]
            row = {"roster_id": rid, "matchup_id": mid, "starters": st, "players": team_players[rid], "points": 0, "starters_points": []}
            if w <= PLAYED:
                row["starters_points"] = [score(k) for k in st]
            elif w == PLAYED + 1:
                row["starters_points"] = [score(k) if rng.random() < 0.5 else 0 for k in st]
            row["points"] = round(sum(row["starters_points"]), 2)
            rows.append(row)
    matchups[str(w)] = rows

rec = {r: {"wins": 0, "losses": 0, "ties": 0, "fpts": 0.0, "fpts_against": 0.0} for r in range(1, N + 1)}
for w in range(1, PLAYED + 1):
    rows = matchups[str(w)]
    for row in rows:
        opp = next(o for o in rows if o["matchup_id"] == row["matchup_id"] and o["roster_id"] != row["roster_id"])
        r = rec[row["roster_id"]]
        r["fpts"] += row["points"]; r["fpts_against"] += opp["points"]
        r["wins" if row["points"] > opp["points"] else "losses"] += 1

DIV = {1: 3, 2: 3, 3: 3, 4: 3, 5: 2, 6: 2, 7: 2, 8: 2, 9: 1, 10: 1, 11: 1, 12: 1}  # 1 east, 2 central, 3 west
rosters = []
for rid in range(1, N + 1):
    r = rec[rid]
    s = {"wins": r["wins"], "losses": r["losses"], "ties": 0, "division": DIV[rid],
         "fpts": int(r["fpts"]), "fpts_decimal": round((r["fpts"] % 1) * 100),
         "fpts_against": int(r["fpts_against"]), "fpts_against_decimal": round((r["fpts_against"] % 1) * 100)}
    entry = {"roster_id": rid, "owner_id": "commissioner" if rid == 1 else None,
             "players": team_players[rid], "starters": team_starters[rid], "reserve": [], "taxi": [], "settings": s}
    if rid == 1:
        entry.update(reserve=reserve, taxi=taxi)
    rosters.append(entry)

def ts(y, m, d, h=12):
    return int(datetime(y, m, d, h, tzinfo=timezone.utc).timestamp() * 1000)

transactions = [
    {"transaction_id": "s-1", "type": "trade", "status": "complete", "leg": 3, "created": ts(2026, 9, 24, 1),
     "roster_ids": [1, 9], "adds": {wr[2]: 1, maye: 9}, "drops": {wr[2]: 9, maye: 1},
     "draft_picks": [
         {"season": "2028", "round": 1, "roster_id": 9, "previous_owner_id": 9, "owner_id": 1},
         {"season": "2027", "round": 2, "roster_id": 1, "previous_owner_id": 1, "owner_id": 9}]},
    {"transaction_id": "s-2", "type": "waiver", "status": "complete", "leg": 5, "created": ts(2026, 10, 7, 9),
     "roster_ids": [1], "adds": {fa_adds[0]: 1}, "drops": {fa_drops[0]: 1}, "draft_picks": [], "settings": {"waiver_bid": 14}},
    {"transaction_id": "s-3", "type": "free_agent", "status": "complete", "leg": 7, "created": ts(2026, 10, 22, 17),
     "roster_ids": [1], "adds": {fa_adds[1]: 1}, "drops": {fa_drops[1]: 1}, "draft_picks": []},
]
traded_picks = [t for t in transactions[0]["draft_picks"]]

keep = set().union(*team_players.values()) | {maye} | set(fa_drops)
FIELDS = ("full_name", "first_name", "last_name", "position", "fantasy_positions", "team", "number", "age", "years_exp",
          "injury_status", "injury_body_part", "college", "height", "weight", "status")
slim = {k: {f: players[k].get(f) for f in FIELDS} for k in keep}

state = {"season": "2026", "week": PLAYED + 1, "display_week": PLAYED, "season_type": "regular"}
for name, data in [("rosters", rosters), ("matchups", matchups), ("transactions", transactions),
                   ("traded_picks", traded_picks), ("players", slim), ("state", state),
                   ("users", [{"user_id": "commissioner", "display_name": "Commissioner", "avatar": None}])]:
    json.dump(data, open(os.path.join(OUT, f"{name}.json"), "w"), indent=1)
print("taxi:", [players[k]["full_name"] for k in taxi])
print("adds:", [players[k]["full_name"] for k in fa_adds], "drops:", [players[k]["full_name"] for k in fa_drops])
print("WYO record:", rec[1])
