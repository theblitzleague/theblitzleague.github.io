#!/usr/bin/env python3
"""Build the claude.ai preview page from a site page (default index.html): the preview host adds its own
<html>/<head>/<body>, so strip those and keep the rest. Usage: python3 tools/make_preview.py OUT.html [SOURCE.html]"""
import sys, os
root = os.path.join(os.path.dirname(__file__), "..")
src = sys.argv[2] if len(sys.argv) > 2 else "index.html"
s = open(os.path.join(root, src)).read()
head = s.split("<head>")[1].split("</head>")[0]
import re
body = re.split(r"<body[^>]*>", s)[1].split("</body>")[0]
head = "\n".join(l for l in head.splitlines() if "charset" not in l and 'name="viewport"' not in l)
import re
head = re.sub(r"<title>.*?</title>", "<title>Blitz Hub</title>", head)
out = '<meta name="claude:viewport-fit-sides" content="cover">\n' + head.strip() + "\n" + body.strip() + "\n"
open(sys.argv[1], "w").write(out)
