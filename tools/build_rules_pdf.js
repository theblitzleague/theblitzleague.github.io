// Print the official rule book: data/rules.html (built by tools/build_rules.py) laid out as a formal document with the
// League seal on the cover, a contents page and running headers, saved to assets/rules/blitz-league-official-rules.pdf.
// Usage: node tools/build_rules_pdf.js [path-to-playwright]   (Playwright with Chromium must be installed)
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { chromium } = require(process.argv[2] || 'playwright');

const frag = fs.readFileSync(path.join(ROOT, 'data', 'rules.html'), 'utf8');
const meta = JSON.parse(frag.match(/<script type="application\/json" id="rb-meta">(.*?)<\/script>/)[1]);
let body = frag.replace(/<!--.*?-->\n?/, '').replace(/<script type="application\/json" id="rb-meta">.*?<\/script>\n?/, '');
// The opening paragraph (how the rules are organized) goes on the contents page, so Rule 1 starts its own page cleanly.
const introMatch = body.match(/^\s*<p>[\s\S]*?<\/p>\n?/);
const intro = introMatch ? introMatch[0] : '';
body = body.slice(intro.length);
const seal = 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, 'assets', 'league', 'blitz-league.webp')).toString('base64');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Barlow+Condensed:wght@600;700;800&display=swap">
<style>
  @page { size: Letter; margin: 0.85in 0.85in 0.8in; }
  :root { --navy: #13203a; --red: #c8102e; --ink: #1d2433; --muted: #5d667a; --rule: #d9dde6; --paper: #fff; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--paper); color: var(--ink); font: 10.5pt/1.5 Barlow, 'Helvetica Neue', Arial, sans-serif; }
  h1, h2, h3, .cond { font-family: 'Barlow Condensed', 'Arial Narrow', sans-serif; }
  .cover { height: 9.3in; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; page-break-after: always; }
  .cover img { width: 3.1in; height: auto; }
  .cover .line { width: 3.6in; height: 3px; background: var(--red); margin: 0.32in 0 0.22in; }
  .cover h1 { font-size: 34pt; font-weight: 800; text-transform: uppercase; letter-spacing: .02em; color: var(--navy); margin: 0; line-height: 1.02; }
  .cover .sub { font-size: 12pt; text-transform: uppercase; letter-spacing: .24em; color: var(--muted); margin-top: 0.14in; font-weight: 600; }
  .cover .adopt { margin-top: 0.42in; font-size: 11pt; color: var(--ink); }
  .cover .office { margin-top: 0.06in; font-size: 10pt; color: var(--muted); }
  .contents { page-break-after: always; }
  .contents h2 { font-size: 20pt; text-transform: uppercase; color: var(--navy); border-bottom: 3px solid var(--red); padding-bottom: 4pt; margin: 0 0 12pt; }
  .contents ol { list-style: none; padding: 0; margin: 0; }
  .contents li { display: flex; gap: 8pt; font-size: 12pt; padding: 5pt 0; border-bottom: 1px dotted var(--rule); }
  .contents li b { font-family: 'Barlow Condensed', sans-serif; color: var(--red); min-width: 0.95in; text-transform: uppercase; letter-spacing: .04em; }
  .intro { color: var(--muted); margin-top: 18pt; padding-top: 10pt; border-top: 1px solid var(--rule); }
  .rules h2 { font-size: 19pt; font-weight: 800; text-transform: uppercase; color: var(--navy); margin: 0 0 8pt; padding-top: 6pt; border-top: 3px solid var(--red); page-break-before: always; page-break-after: avoid; }
  .rules h2:first-child { page-break-before: auto; }
  .rules h3 { font-size: 12.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--red); margin: 14pt 0 4pt; page-break-after: avoid; }
  .rules p, .intro p { margin: 5pt 0; orphans: 3; widows: 3; }
  .rules strong { color: var(--navy); }
  .rb-penalty { border-left: 3px solid var(--red); padding: 4pt 0 4pt 9pt; background: #fbf1f2; }
  .rb-ar { margin: 7pt 0; padding: 6pt 10pt; border-left: 3px solid var(--navy); background: #f2f4f8; page-break-inside: avoid; }
  .rb-table { margin: 7pt 0; page-break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; font-size: 9.6pt; }
  th, td { text-align: left; padding: 4pt 7pt; border-bottom: 1px solid var(--rule); vertical-align: top; }
  th { font-family: 'Barlow Condensed', sans-serif; text-transform: uppercase; letter-spacing: .05em; color: #fff; background: var(--navy); font-weight: 700; }
  tbody tr:nth-child(even) td { background: #f7f8fb; }
  /* Two-column tables (scoring, divisions) share one column width, so they line up page to page. */
  th:nth-child(2):last-child, td:nth-child(2):last-child { width: 32%; }
  ol { margin: 5pt 0; }
</style></head><body>
<section class="cover">
  <img src="${seal}" alt="The Blitz League seal">
  <div class="line"></div>
  <h1>Official Rules</h1>
  <div class="sub">of The Blitz League</div>
  ${meta.adopted ? `<div class="adopt">Adopted ${esc(meta.adopted)}</div>` : ''}
  <div class="office">Issued by the Commissioner's Office · theblitzleague.github.io</div>
</section>
<section class="contents">
  <h2>Contents</h2>
  <ol>${meta.toc.map(([, t]) => { const m = t.match(/^(Rule \d+|Appendix [A-Z])\.?\s*(.*)$/); return `<li><b>${esc(m ? m[1] : '')}</b><span>${esc(m ? m[2] : t)}</span></li>`; }).join('')}</ol>
  <div class="intro">${intro}</div>
</section>
<section class="rules">${body}</section>
</body></html>`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(page, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const out = path.join(ROOT, 'assets', 'rules', 'blitz-league-official-rules.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const foot = `<div style="width:100%;font:8pt Arial,sans-serif;color:#5d667a;padding:0 0.85in;display:flex;justify-content:space-between">
    <span>THE BLITZ LEAGUE · OFFICIAL RULES</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
  await p.pdf({ path: out, format: 'Letter', printBackground: true, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: foot,
    margin: { top: '0.85in', bottom: '0.8in', left: '0.85in', right: '0.85in' } });
  await b.close();
  console.log('wrote', out, Math.round(fs.statSync(out).size / 1024) + ' KB');
})();
