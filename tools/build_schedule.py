#!/usr/bin/env python3
"""The Hub's own league schedule: data/schedule.json  {season: {status, note, weeks: {"1": [[team, team], ...], ...}}}.
Week results (functions/index.js weekResults) pair teams from it; regular season only (Weeks 1-14, rule 7-1-1). The
playoff weeks are paired by the bracket, not this file.

  python3 tools/build_schedule.py --from-sample 2026     copy the current season's pairings from data/sample/matchups.json
  python3 tools/build_schedule.py 2027 [--seed N]        build a new season: 14 weeks, 12 teams in 3 divisions of 4

A new season is balanced the usual way for this shape: each team plays its 3 division rivals twice (6 games) and each of
the 8 teams in the other two divisions once (8 games) = 14 weeks. Weeks 13 and 14 are all division games, so races
finish head to head. It is written with status "proposed" until the Commissioner's Office publishes it."""
import json, os, random, sys
ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "schedule.json")
sched = json.load(open(OUT)) if os.path.exists(OUT) else {"_readme": __doc__.split("\n\n")[0]}

def round_robin(teams):            # 4 teams -> 3 rounds of 2 games
    a, b, c, d = teams
    return [[(a, b), (c, d)], [(a, c), (b, d)], [(a, d), (b, c)]]

def cross(x, y, k):                # division x vs division y, round k of 4: x[i] plays y[(i+k)%4]
    return [(x[i], y[(i + k) % 4]) for i in range(4)]

if "--from-sample" in sys.argv:
    season = sys.argv[sys.argv.index("--from-sample") + 1]
    m = json.load(open(os.path.join(ROOT, "data", "sample", "matchups.json")))
    weeks = {}
    for w, rows in m.items():
        pairs = {}
        for r in rows:
            pairs.setdefault(r["matchup_id"], []).append(r["roster_id"])
        weeks[w] = sorted([sorted(p) for p in pairs.values() if len(p) == 2])
    sched[season] = {"status": "published", "note": "The 2026 test season's schedule, copied from the placeholder league so its played weeks stay as they were.", "weeks": weeks}
else:
    season = sys.argv[1]
    seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else int(season)
    rnd = random.Random(seed)
    league = json.load(open(os.path.join(ROOT, "data", "league.json")))
    fr = json.load(open(os.path.join(ROOT, "data", "franchises.json")))["franchises"]
    divs = {}
    for rid, f in fr.items():
        divs.setdefault(f["division"], []).append(int(rid))
    D = [sorted(v) for _, v in sorted(divs.items())]
    assert len(D) == 3 and all(len(d) == 4 for d in D), "this generator is for 3 divisions of 4"
    for d in D: rnd.shuffle(d)
    # Each division plays its own games in the 4 weeks the other two divisions play each other, plus Weeks 13-14.
    # Its rounds go in date order: the 3 first meetings, then the 3 rematches in the same order, so every pair of
    # division rivals meets once in each half. Of many orders of the 12 cross-division weeks, keep the one whose
    # closest rematch is furthest apart (then the fewest back-to-back division weeks for any team).
    rr = [round_robin(d) for d in D]
    def build(order):
        weeks = []
        for (x, y, z, k) in order:
            weeks.append((cross(D[x], D[y], k), z))
        weeks = [(w, z) for w, z in weeks] + [(None, None), (None, None)]
        slots = {0: [], 1: [], 2: []}
        for i, (w, z) in enumerate(weeks):
            for dz in ([z] if z is not None else [0, 1, 2]):
                slots[dz].append(i)
        games = [[] for _ in weeks]
        for i, (w, z) in enumerate(weeks):
            if w: games[i] += w
        for dz in range(3):
            seq = rr[dz] + [list(reversed(r)) for r in rr[dz]]
            for slot, rnd_games in zip(slots[dz], seq):
                games[slot] += rnd_games
        return games
    def score(games):
        seen, gap, b2b = {}, 99, 0
        for i, w in enumerate(games):
            for a, b in w:
                key = tuple(sorted((a, b)))
                if key in seen: gap = min(gap, i - seen[key])
                seen[key] = i
        for d in D:
            for t in d:
                div = [i for i, w in enumerate(games) for g in w if t in g and all(x in d for x in g)]
                b2b += sum(1 for a, b in zip(div, div[1:]) if b - a == 1)
        return (gap, -b2b)
    base = [(x, y, z, k) for x, y, z in [(0, 1, 2), (0, 2, 1), (1, 2, 0)] for k in range(4)]
    best = None
    for _ in range(4000):
        order = base[:]; rnd.shuffle(order)
        g = build(order); sc = score(g)
        if best is None or sc > best[0]: best = (sc, g)
    weeks = best[1]
    print("closest rematch:", best[0][0], "weeks apart; back-to-back division games:", -best[0][1])
    games = {}
    for w in weeks:
        for a, b in w:
            games[tuple(sorted((a, b)))] = games.get(tuple(sorted((a, b))), 0) + 1
    for d in D:
        for a in d:
            assert sum(1 for w in weeks for g in w if a in g) == 14
            for b in d:
                if a < b: assert games[(a, b)] == 2
    assert all(n <= 2 for n in games.values()) and len([1 for n in games.values() if n == 1]) == 48
    sched[season] = {"status": "proposed", "note": f"Generated by tools/build_schedule.py (seed {seed}): division rivals twice, every other team once, Weeks 13-14 all division games. Waiting for the Commissioner's Office to publish.",
                     "weeks": {str(i + 1): sorted([sorted(g) for g in w]) for i, w in enumerate(weeks)}}
json.dump(sched, open(OUT, "w"), indent=1)
print("wrote", OUT, "season", season, len(sched[season]["weeks"]), "weeks")
