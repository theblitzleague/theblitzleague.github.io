#!/usr/bin/env python3
"""Build the League's official rules for the website from data/rules.md (exported from the Commissioner's rulebook doc,
"Official Rules" tab only; the Commissioner's Notes tab is private and never exported).

Writes data/rules.html: the rules as an HTML fragment for rules.html (js/rules.js) and for the printable rule book
(tools/build_rules_pdf.js). Handles the Markdown the export uses: headings, paragraphs, **bold**, pipe tables,
numbered lists and "> " approved rulings.
Usage: python3 tools/build_rules.py [--adopted "November 7, 2026"]"""
import html, os, re, sys, json

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC, OUT = os.path.join(ROOT, "data", "rules.md"), os.path.join(ROOT, "data", "rules.html")
adopted = sys.argv[sys.argv.index("--adopted") + 1] if "--adopted" in sys.argv else None

def inline(t):
    t = html.escape(t, quote=False)
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)

def slug(t):
    m = re.match(r"(Rule \d+|Appendix [A-Z])", t)
    return re.sub(r"[^a-z0-9]+", "-", (m.group(1) if m else t).lower()).strip("-")

lines = open(SRC, encoding="utf-8").read().splitlines()
out, toc, i = [], [], 0
title = lines[0].lstrip("# ").strip()
# Skip the doc's byline (date chip and author mention) and its own Contents list; the page builds its own contents.
i = 1
while i < len(lines) and not lines[i].startswith("These rules govern"):
    i += 1
in_contents = False
while i < len(lines):
    ln = lines[i]
    if ln.startswith("## Contents"):
        in_contents = True; i += 1; continue
    if in_contents:
        if ln.startswith("## "): in_contents = False
        else: i += 1; continue
    if not ln.strip():
        i += 1; continue
    if ln.startswith("### "):
        out.append(f"<h3>{inline(ln[4:])}</h3>")
    elif ln.startswith("## "):
        t = ln[3:].strip(); sid = slug(t); toc.append((sid, t))
        out.append(f'<h2 id="{sid}">{inline(t)}</h2>')
    elif ln.startswith("|"):
        rows = []
        while i < len(lines) and lines[i].startswith("|"):
            cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
            if not all(re.fullmatch(r":?-{3,}:?", c) for c in cells): rows.append(cells)
            i += 1
        head, body = rows[0], rows[1:]
        out.append('<div class="rb-table"><table><thead><tr>' + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
                   + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body) + "</tbody></table></div>")
        continue
    elif re.match(r"\d+\. ", ln):
        items = []
        while i < len(lines) and re.match(r"\d+\. ", lines[i]):
            items.append(re.sub(r"^\d+\. ", "", lines[i])); i += 1
        out.append("<ol>" + "".join(f"<li>{inline(x)}</li>" for x in items) + "</ol>")
        continue
    elif ln.startswith("> "):
        out.append(f'<blockquote class="rb-ar">{inline(ln[2:])}</blockquote>')
    elif ln.startswith("**Penalty:**"):
        out.append(f'<p class="rb-penalty">{inline(ln)}</p>')
    else:
        out.append(f"<p>{inline(ln)}</p>")
    i += 1

meta = {"title": title, "adopted": adopted, "toc": toc}
open(OUT, "w", encoding="utf-8").write(f"<!-- Built by tools/build_rules.py from data/rules.md. Don't edit by hand. -->\n"
                                      f'<script type="application/json" id="rb-meta">{json.dumps(meta)}</script>\n' + "\n".join(out) + "\n")
print(f"wrote {OUT}: {len(toc)} rules and appendices, {len(out)} blocks")
