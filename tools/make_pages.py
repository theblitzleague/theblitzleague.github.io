#!/usr/bin/env python3
"""Generate every site page from one template so the header, nav and script list never drift.
Run it after any change to css/ or js/ too: the links carry a content hash for cache busting.
Usage: python3 tools/make_pages.py   (writes *.html in the site root)"""
import os, hashlib
ROOT = os.path.join(os.path.dirname(__file__), "..")
# Ordered by how often people use them (game-day pages first). The League Map lives under Teams (a tab on that page),
# and Account is the profile icon at the right end of the bar, not a menu item.
NAV = [("./", "Home"), ("matchup.html", "Matchups"), ("standings.html", "Standings"), ("schedule.html", "Schedule"), ("network.html", "Network"),
       ("teams.html", "Teams"), ("draft.html", "Draft"), ("awards.html", "Awards"), ("almanac.html", "Almanac"), ("rules.html", "Rules")]
CRUMB = {"map.html": "League Map", "account.html": "Account"}
# Nav items shown as a logo instead of their label (the label stays as the image's alt text and the crumb).
# width/height keep it small even if a stale stylesheet is in use.
NAV_ART = {"network.html": '<img src="assets/league/blitz-network-white.webp" alt="Blitz Network" width="84" height="22">'}
# file: (title, nav item it belongs to, page script, extra scripts, body attrs, has tabs)
PAGES = {
    "index.html": ("Blitz Hub", "./", "home.js", ["nfl.js", "firebase-config.js"], "", False),
    "standings.html": ("Standings · Blitz Hub", "standings.html", "standings.js", [], "", True),
    "awards.html": ("Awards Race · Blitz Hub", "awards.html", "awards.js", [], "", True),
    "teams.html": ("Franchises · Blitz Hub", "teams.html", "teams.js", [], "", True),
    "team.html": ("Team · Blitz Hub", "teams.html", "team.js", ["lineup.js"], ' data-team="1"', True),
    "matchup.html": ("Matchup · Blitz Hub", "matchup.html", "matchup.js", [], "", False),
    "schedule.html": ("Schedule · Blitz Hub", "schedule.html", "schedule.js", [], "", True),
    "draft.html": ("Draft · Blitz Hub", "draft.html", "draft.js", [], "", True),
    "draftroom.html": ("Draft Room · Blitz Hub", "draft.html", "draftroom.js", ["firebase-config.js"], "", False),
    "almanac.html": ("Almanac · Blitz Hub", "almanac.html", "almanac.js", [], "", True),
    "map.html": ("League Map · Blitz Hub", "teams.html", "map.js", ["us-map.js"], "", False),
    "network.html": ("Blitz Network · Blitz Hub", "network.html", "network.js", ["nfl.js"], "", True),
    "rules.html": ("Official Rules · Blitz Hub", "rules.html", "rules.js", [], "", False),
    # Sign-in, notifications, and (for the commissioner only) the Commissioner panel.
    "account.html": ("Account · Blitz Hub", None, "account.js", ["firebase-config.js"], "", False),
}
# Page scripts loaded as ES modules (they import the Firebase SDK).
MODULES = {"account.js", "draftroom.js", "lineup.js"}
TPL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,700;1,800&display=swap">
<link rel="stylesheet" href="{css}">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0e131c">
<link rel="icon" type="image/png" sizes="32x32" href="assets/icons/favicon-32.png">
<link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Blitz Hub">
<meta name="blitz-notes" content="{notes}">
<meta name="blitz-ledger" content="{ledger}">
<meta name="blitz-version" content="{version}">
</head>
<body{body}>
<header class="topbar"><div class="wrap">
  <a class="brand" href="./"><img class="brand-logo" src="assets/league/blitz-hub.webp" alt="Blitz Hub" width="672" height="132"></a>
  <nav class="nav" aria-label="League">
    {nav}
  </nav>
  <div class="season" id="season"></div>
  <a class="acct-ico" href="account.html" aria-label="Account"{acct}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></a>
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

# The site's code version: one hash over every stylesheet and script. Each page carries the version it was built with,
# and version.json holds the newest; js/ui.js compares the two and offers a refresh when the site has been updated.
import glob, json
_h = hashlib.sha1()
for f in sorted(glob.glob(os.path.join(ROOT, "css", "*.css")) + glob.glob(os.path.join(ROOT, "js", "*.js")) + [os.path.join(ROOT, "sw.js")]):
    _h.update(open(f, "rb").read())
VERSION = _h.hexdigest()[:10]
json.dump({"v": VERSION}, open(os.path.join(ROOT, "version.json"), "w"))

for fn, (title, cur, script, extra, body, tabs) in PAGES.items():
    cur_attr = ' aria-current="page"'
    nav = "".join(f'<a href="{h}"{cur_attr if h == cur else ""}{' class="nav-logo"' if h in NAV_ART else ""}>{NAV_ART.get(h, l)}</a>' for h, l in NAV)
    scripts = "\n".join(f'<script{' type="module"' if s in MODULES else ""} src="{ver("js/" + s)}"></script>' for s in ["helmet.js", "data.js", "ui.js", "player.js", *dict.fromkeys(["nfl.js", "firebase-config.js", *extra]), script])
    crumb = CRUMB.get(fn) or dict(NAV).get(cur, title.split(" · ")[0])
    open(os.path.join(ROOT, fn), "w").write(TPL.format(css=ver("css/hub.css"), title=title, body=body, nav=nav, crumb=crumb, tabs='<div id="tabs"></div>\n' if tabs else "", scripts=scripts, notes=ver("js/notes.js"), ledger=ver("js/ledger.js"), version=VERSION, acct=' aria-current="page"' if fn == "account.html" else ""))
print("wrote", ", ".join(PAGES))
