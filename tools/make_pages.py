#!/usr/bin/env python3
"""Generate every site page from one template so the header, nav and script list never drift.
Run it after any change to css/ or js/ too: the links carry a content hash for cache busting.
Usage: python3 tools/make_pages.py   (writes *.html in the site root)"""
import os, hashlib
ROOT = os.path.join(os.path.dirname(__file__), "..")
NAV = [("./", "Home"), ("standings.html", "Standings"), ("awards.html", "Awards"), ("teams.html", "Teams"), ("matchup.html", "Matchups"), ("schedule.html", "Schedule"), ("network.html", "Network"),
       ("draft.html", "Draft"), ("almanac.html", "Almanac"), ("map.html", "League Map")]
# Nav items shown as a logo instead of their label (the label stays as the image's alt text and the crumb).
# width/height keep it small even if a stale stylesheet is in use.
NAV_ART = {"network.html": '<img src="assets/league/blitz-network-white.webp" alt="Blitz Network" width="84" height="22">'}
# file: (title, nav item it belongs to, page script, extra scripts, body attrs, has tabs)
PAGES = {
    "index.html": ("The Blitz League", "./", "home.js", ["nfl.js"], "", False),
    "standings.html": ("Blitz League Standings", "standings.html", "standings.js", [], "", True),
    "awards.html": ("Blitz League Awards Race", "awards.html", "awards.js", [], "", True),
    "teams.html": ("Blitz League Franchises", "teams.html", "teams.js", [], "", True),
    "team.html": ("Blitz League Team", "teams.html", "team.js", [], ' data-team="1"', True),
    "matchup.html": ("Blitz League Matchup", "matchup.html", "matchup.js", [], "", False),
    "schedule.html": ("Blitz League Schedule", "schedule.html", "schedule.js", [], "", True),
    "draft.html": ("Blitz League Draft", "draft.html", "draft.js", [], "", True),
    "almanac.html": ("Blitz League Almanac", "almanac.html", "almanac.js", [], "", True),
    "map.html": ("Blitz League Map", "map.html", "map.js", ["us-map.js"], "", False),
    "network.html": ("Blitz Network", "network.html", "network.js", ["nfl.js"], "", True),
}
TPL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600&family=Oswald:wght@500;600;700&display=swap">
<link rel="stylesheet" href="{css}">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0e131c">
<link rel="icon" type="image/png" sizes="32x32" href="assets/icons/favicon-32.png">
<link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Blitz League">
</head>
<body{body}>
<header class="topbar"><div class="wrap">
  <a class="brand" href="./"><img class="brand-logo" src="assets/league/blitz-shield.webp" alt="The Blitz League"><span><b>BLITZ</b> LEAGUE</span></a>
  <nav class="nav" aria-label="League">
    {nav}
  </nav>
  <div class="season" id="season"></div>
</div></header>
<div class="sample-flag" id="sample-flag"><div class="wrap">Preview · player info is real Sleeper data; rosters, scores, trades and picks are placeholders</div></div>
<div class="crumb"><div class="wrap" id="crumb">{crumb}</div></div>
<div id="hero"></div>
{tabs}<main><div class="wrap" id="content"><div class="loading">Loading league data</div></div></main>
{scripts}
<script>if ('serviceWorker' in navigator && location.protocol === 'https:' && window.top === window) navigator.serviceWorker.register('sw.js').catch(() => {{}});</script>
</body>
</html>
"""
# Each stylesheet and script is linked with a hash of its contents (?v=...), so a browser can never pair a new page
# with an old cached copy of them. Rerun this script after changing any file in css/ or js/.
def ver(path):
    return f"{path}?v={hashlib.sha1(open(os.path.join(ROOT, path), 'rb').read()).hexdigest()[:8]}"

for fn, (title, cur, script, extra, body, tabs) in PAGES.items():
    cur_attr = ' aria-current="page"'
    nav = "".join(f'<a href="{h}"{cur_attr if h == cur else ""}{' class="nav-logo"' if h in NAV_ART else ""}>{NAV_ART.get(h, l)}</a>' for h, l in NAV)
    scripts = "\n".join(f'<script src="{ver("js/" + s)}"></script>' for s in ["helmet.js", "data.js", "ui.js", "player.js", *extra, script])
    crumb = dict(NAV)[cur]
    open(os.path.join(ROOT, fn), "w").write(TPL.format(css=ver("css/hub.css"), title=title, body=body, nav=nav, crumb=crumb, tabs='<div id="tabs"></div>\n' if tabs else "", scripts=scripts))
print("wrote", ", ".join(PAGES))
