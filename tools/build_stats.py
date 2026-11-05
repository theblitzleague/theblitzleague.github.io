#!/usr/bin/env python3
"""Build data/stats/<season>.json: a snapshot of weekly game logs for every player on a Blitz League roster.

The player card (js/player.js) asks Sleeper for a player's game log directly. Where that call can't be made (the
claude.ai preview blocks outside requests) or fails (the endpoint is undocumented and could change), the card falls
back to this snapshot. Run it daily alongside tools/build_players.py.

Source: https://api.sleeper.com/stats/nfl/player/{id}?season_type=regular&season={season}&grouping=week
(the Sleeper app's own endpoint, not part of the documented API). Requests are sequential with a short pause.

Kept per game: opponent, home/away, and only the stat keys the card shows or that feed fantasy points
(Sleeper's default pts_* plus, in live mode, every key in the league's scoring_settings).

Usage: python3 tools/build_stats.py [season ...]   (default: the current season and the one before)"""
import json, os, sys, time, urllib.request, datetime

ROOT = os.path.join(os.path.dirname(__file__), "..")
API = "https://api.sleeper.app/v1"
STATS = "https://api.sleeper.com/stats/nfl/player/{id}?season_type=regular&season={season}&grouping=week"
CARD_KEYS = {  # every key js/player.js COLS reads, plus what decides "played" and default fantasy points
    "gp", "pts_ppr", "pts_idp", "off_snp", "tm_off_snp", "def_snp", "tm_def_snp",
    "pass_cmp", "pass_att", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td",
    "rec_tgt", "rec", "rec_yd", "rec_td", "fgm", "fga", "fgm_lng", "xpm", "xpa",
    "idp_tkl", "idp_tkl_solo", "idp_tkl_ast", "idp_tkl_loss", "idp_sack", "idp_qb_hit", "idp_pass_def", "idp_int",
    "idp_ff", "idp_fum_rec", "idp_def_td", "pts_allow", "def_sack", "def_int", "def_fum_rec", "def_td", "def_safe"}

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "blitz-league-hub/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

league = json.load(open(os.path.join(ROOT, "data", "league.json")))
keys = set(CARD_KEYS)
if league.get("sleeperLeagueId"):
    lid = league["sleeperLeagueId"]
    rosters = get(f"{API}/league/{lid}/rosters")
    keys |= set((get(f"{API}/league/{lid}").get("scoring_settings") or {}))
    state = get(f"{API}/state/nfl")
else:
    rosters = json.load(open(os.path.join(ROOT, "data", "sample", "rosters.json")))
    state = json.load(open(os.path.join(ROOT, "data", "sample", "state.json")))
    tx = json.load(open(os.path.join(ROOT, "data", "sample", "transactions.json")))

ids = set()
for r in rosters:
    ids.update((r.get("players") or []) + (r.get("taxi") or []) + (r.get("reserve") or []))
if not league.get("sleeperLeagueId"):
    for x in tx:
        ids.update(list((x.get("adds") or {}).keys()) + list((x.get("drops") or {}).keys()))
ids = sorted(i for i in ids if i and i != "0" and i.isdigit())        # team defenses (e.g. "HOU") have no game log here

seasons = sys.argv[1:] or [state["season"], str(int(state["season"]) - 1)]
os.makedirs(os.path.join(ROOT, "data", "stats"), exist_ok=True)
for season in seasons:
    out, failed = {}, []
    for n, pid in enumerate(ids, 1):
        try:
            d = get(STATS.format(id=pid, season=season)) or {}
        except Exception as e:
            failed.append(f"{pid}: {e}")
            continue
        log = {}
        for wk, e in d.items():
            if not e:
                continue
            log[wk] = {"opponent": e.get("opponent"), "is_away_team": e.get("is_away_team"),
                       "stats": {k: v for k, v in (e.get("stats") or {}).items() if k in keys and v}}
        out[pid] = log
        time.sleep(0.05)
    if len(failed) > len(ids) // 10:
        sys.exit(f"{season}: {len(failed)} of {len(ids)} requests failed (first: {failed[0]}); not writing a partial snapshot")
    path = os.path.join(ROOT, "data", "stats", f"{season}.json")
    doc = {"season": season, "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "players": out}
    json.dump(doc, open(path + ".tmp", "w"), separators=(",", ":"))
    os.replace(path + ".tmp", path)
    print(f"{season}: {len(out)} players, {len(failed)} failed, {os.path.getsize(path) // 1024} KB -> {path}")
