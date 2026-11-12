/* Shared page helpers: formatting, player bits, and franchise colors. Used by every page. */
(function () {
  const SIL = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#171e2b"/><circle cx="40" cy="31" r="14" fill="#2e3747"/><path d="M12 80c2-18 14-28 28-28s26 10 28 28z" fill="#2e3747"/></svg>');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const f2 = n => (Math.round(n * 100) / 100).toFixed(2);
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const SLOT_LABEL = { SUPER_FLEX: 'Superflex', FLEX: 'Flex', REC_FLEX: 'Rec Flex', WRRB_FLEX: 'W/R Flex', IDP_FLEX: 'IDP Flex' };
  const SLOT_SHORT = { SUPER_FLEX: 'SF', FLEX: 'FLX', REC_FLEX: 'RFX', WRRB_FLEX: 'WR/RB', IDP_FLEX: 'IDP' };
  // Display and grouping order for every roster list.
  const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];

  function lum(hex) {
    const v = hex.replace('#', '').match(/../g).map(x => parseInt(x, 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }

  const shot = (id, cls) => `<img class="shot ${cls || ''}" src="${Hub.headshot(id)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${SIL}'">`;
  const teamName = t => t.f.nickname ? `${t.f.location} ${t.f.nickname}` : t.f.location;
  const rec = t => `${t.wins}-${t.losses}${t.ties ? '-' + t.ties : ''}`;

  function badge(p) {
    const s = p.injury_status;
    if (!s) return '';
    const cls = { Out: 'out', IR: 'ir', PUP: 'ir', Sus: 'out', Questionable: 'q', Doubtful: 'd' }[s] || 'q';
    const label = { Questionable: 'Q', Doubtful: 'D' }[s] || s;
    const tip = [s, p.injury_body_part, p.injury_note].filter(Boolean).join(' · ');
    return `<span class="tag ${cls}" title="${esc(tip)}">${esc(label)}</span>`;
  }
  const status = p => (p && p._id ? `<span class="inj" data-inj="${esc(p._id)}">${badge(p)}</span>` : badge(p));
  const pmeta = p => [p.team || 'FA', p.number != null ? '#' + p.number : null, p.age ? `${p.age} yrs` : null].filter(Boolean).join(' · ');

  // Color washed in behind a team. A near-black primary would vanish on the dark site, so use a darkened secondary.
  function wash(f) {
    const c = f.colors;
    if (lum(c.primary) > 0.012) return c.primary;
    return '#' + c.secondary.replace('#', '').match(/../g).map(x => Math.round(parseInt(x, 16) * 0.34).toString(16).padStart(2, '0')).join('');
  }
  // A team color that stays readable as text on the dark ground.
  const accentFor = f => (lum(f.colors.secondary) > 0.07 ? f.colors.secondary : f.colors.trim);

  function applyColors(f) {
    const s = document.documentElement.style, c = f.colors, accent = accentFor(f);
    s.setProperty('--t1', c.primary); s.setProperty('--t2', c.secondary); s.setProperty('--t3', c.trim);
    s.setProperty('--wash', wash(f));
    s.setProperty('--accent', accent); s.setProperty('--on-accent', lum(accent) > 0.4 ? '#0a0e15' : '#fff');
  }

  function primaryLogo(f, cls) {
    const src = f.logos && f.logos.primary;
    return src ? `<img class="${cls || 'mark'} logo-img" src="${esc(src)}" alt="${esc(f.location)} logo">` : markSVG(f, cls);
  }

  // Matchup screens: a team's matchup badge (logos.matchup, e.g. a script logo), else the fallback.
  function matchupLogo(f, cls, fallback) {
    const src = f.logos && f.logos.matchup;
    return src ? `<img class="${cls || 'mark'} logo-img mu-logo" src="${esc(src)}" alt="${esc(f.location)}${f.nickname ? ' ' + esc(f.nickname) : ''}">` : fallback(f, cls);
  }

  // League-page header: shield, title, one-line summary, division marks.
  function leagueHero(M, eyebrow, title, sub) {
    const lg = M.league;
    return `<section class="lhero">${lg.logo ? `<img class="hero-watermark" src="${esc(lg.logo)}" alt="" aria-hidden="true">` : ''}<div class="wrap">
      ${lg.logo ? `<img class="lhero-logo" src="${esc(lg.logo)}" alt="${esc(lg.name)}">` : ''}
      <div><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1>${sub ? `<div class="nick">${sub}</div>` : ''}</div>
    </div></section>`;
  }

  const tabsHTML = (tabs, cur) => `<div class="tabs"><div class="wrap" role="tablist">${tabs.map(([id, l]) =>
    `<a class="tab" role="tab" href="#${id}" aria-selected="${id === cur}">${esc(l)}</a>`).join('')}</div></div>`;

  // Shared page start: load the model, fill the top bar, then hand over. Errors land in the page, not just the console.
  async function boot(crumb, run) {
    try {
      const M = await Hub.load();
      document.getElementById('sample-flag').hidden = M.live;
      myTeam(M);
      document.getElementById('season').innerHTML = `<strong>${esc(M.state.season)} season</strong><span>Week ${M.current}</span>`;
      if (crumb) document.getElementById('crumb').innerHTML = crumb;
      await run(M);
    } catch (e) {
      document.getElementById('content').innerHTML = `<div class="error">Couldn't load league data. ${esc(e.message)}</div>`;
      console.error(e);
    }
  }

  // One entry per actual game (each game appears once, not once per side).
  function allGames(M, filter) {
    const seen = new Set(), out = [];
    for (const t of Object.values(M.teams)) for (const g of t.games) {
      if (!g.opp || (filter && !filter(g))) continue;
      const k = g.week + ':' + Math.min(t.id, g.opp.id);
      if (seen.has(k)) continue;
      seen.add(k); out.push(g);
    }
    return out.sort((a, b) => a.week - b.week);
  }

  // Marks an element as opening the player card (js/player.js) on click or Enter.
  const pid = id => ` data-pid="${esc(id)}" tabindex="0" role="button"`;

  const divInk = d => d.inkOnDark || d.markOnDark || d.colors[0];

  // Prize money (league.json "prizes"). cash(n) is the gold chip shown beside an award; '' when that prize isn't set.
  const money = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const cash = (n, cls) => (n ? `<span class="cash${cls ? ' ' + cls : ''}">${money(n)}</span>` : '');
  const honorOnly = () => '<span class="cash none">Honor only</span>';
  const prizes = M => M.league.prizes || {};
  // Each final regular-season week's high score (js/data.js weeklyHighs) with its share of the prize. A tie splits it.
  const weeklyWinners = M => M.weekly.map(w => ({ ...w, each: (prizes(M).weekly || 0) / w.winners.length }));
  // ---------- Broadcast and betting line (ESPN-style, for fun; the site's own projection, not a sportsbook) ----------
  // Normal CDF (Abramowitz-Stegun 7.1.26).
  const Phi = z => { const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2); return z >= 0 ? (1 + y) / 2 : (1 - y) / 2; };
  // Line for one game, using only weeks finished BEFORE it (so a final game shows its closing line). Each team's projection
  // is its average pulled toward the league average (k = 3 games, as in the playoff odds); spread and total round to the
  // half point; win chance uses the league's score spread; moneyline is the fair price for that chance, rounded to 5.
  function line(M, g) {
    if (!g || !g.opp) return null;
    const before = t => t.games.filter(x => x.final && x.week < g.week).map(x => x.me.points);
    const all = Object.values(M.teams).flatMap(before);
    if (all.length < 2) return null;
    const lg = all.reduce((a, b) => a + b, 0) / all.length, sd = Math.sqrt(all.reduce((n, x) => n + (x - lg) ** 2, 0) / (all.length - 1)) || 20;
    const proj = t => { const s = before(t); return (s.reduce((a, b) => a + b, 0) + 3 * lg) / (s.length + 3); };
    const L = M.teams[g.me.roster_id], R = g.opp, pl = proj(L), pr = proj(R), half = x => Math.round(x * 2) / 2;
    const p = Phi((pl - pr) / (sd * Math.SQRT2));
    const ml = q => { q = Math.min(0.97, Math.max(0.03, q)); return Math.round((q >= 0.5 ? -100 * q / (1 - q) : 100 * (1 - q) / q) / 5) * 5; };
    return { L, R, fav: pl >= pr ? L : R, dog: pl >= pr ? R : L, spread: half(Math.abs(pl - pr)), total: half(pl + pr), pL: p, mlL: ml(p), mlR: ml(1 - p) };
  }
  const mlTxt = v => (v > 0 ? '+' + v : '−' + Math.abs(v));
  // Odds block under a game. Final games show the closing line and how it landed.
  function oddsHTML(M, g, compact) {
    const l = line(M, g);
    if (!l) return compact ? '' : '<div class="odds-line"><span>Lines open after week 1</span></div>';
    const ab = t => esc(t.f.abbr || t.f.location);
    const sp = l.spread ? `${ab(l.fav)} −${l.spread}` : 'Pick’em';
    let res = '', ats = '';
    if (g.final) {
      const a = g.me.points, b = g.oppRow.points, favPts = l.fav === l.L ? a : b, dogPts = l.fav === l.L ? b : a, m = favPts - dogPts;
      ats = !l.spread ? '' : m > l.spread ? `${ab(l.fav)} covered` : m < l.spread ? `${ab(l.dog)} covered` : 'Push';
      const ou = a + b > l.total ? 'Over' : a + b < l.total ? 'Under' : 'Push';
      res = `<span class="res">${[ats, ou].filter(Boolean).join(' · ')}</span>`;
    }
    if (compact) return g.final ? `<div class="odds-line sm"><span>Closed ${sp}</span><span>${ats || `O/U ${l.total}`}</span></div>`
      : `<div class="odds-line sm"><span>${sp}</span><span>O/U ${l.total}</span></div>`;
    return `<div class="odds-line"><span class="hd">${g.final ? 'Closing line' : 'Line'}</span><span><b>Spread</b> ${sp}</span><span><b>O/U</b> ${l.total}</span>
      <span><b>ML</b> ${ab(l.L)} ${mlTxt(l.mlL)} · ${ab(l.R)} ${mlTxt(l.mlR)}</span>${res}</div>`;
  }
  // Game billing above the status badge, like a broadcast banner: the week, then only the tags that are true.
  //   division game (both teams in one division, in its color) / 1st place on the line (the division's current 1st and 2nd
  //   meet; skipped once the game is final, since standings have moved on) / rematch (their latest earlier final meeting).
  function billingHTML(M, g, opts = {}) {
    if (!g || !g.opp) return '';
    const L = M.teams[g.me.roster_id], R = g.opp, ab = t => esc(t.f.abbr || t.f.location), tags = [];
    if (g.playoff) tags.push(`<b class="hot">${esc(g.label || 'Playoffs')}${g.me.seed && g.oppRow && g.oppRow.seed ? ` · ${g.me.seed} seed vs ${g.oppRow.seed} seed` : ''}</b>`);
    else if (L.division && L.division === R.division) {
      tags.push(L.division.mark                        // the division's own logo stands in for the "Division game" tag
        ? `<b class="divgame" title="${esc(L.division.name)} game">${divMarkHTML(L.division, 'divgame-mark')}</b>`
        : `<b style="--tc:${divInk(L.division)}">${esc(L.division.name)} game</b>`);
      if (!g.final && [L.divRank, R.divRank].sort().join() === '1,2') tags.push('<b class="hot">1st place on the line</b>');
    }
    const prev = L.games.filter(x => x.final && x.week < g.week && x.opp && x.opp.id === R.id).pop();
    if (prev) tags.push(`<b>Rematch · ${prev.result === 'T' ? 'tied' : `${ab(prev.result === 'W' ? L : R)} won`} wk ${prev.week}</b>`);
    if (opts.tagsOnly) return tags.length ? `<div class="billing"><span class="tags">${tags.join('')}</span></div>` : '';
    return `<div class="billing"><span class="wk">${opts.season ? esc(M.state.season) + ' · ' : ''}Week ${g.week}</span>${tags.length ? `<span class="tags">${tags.join('')}</span>` : ''}</div>`;
  }
  // "Watch on" slot: the league network's logo once it exists, a wordmark until then.
  function broadcastHTML(M) {
    const n = M.league.network || {};
    return `<div class="onair"><span>Watch on</span>${netWord(M)}</div>`;
  }
  const netWord = M => {
    const net = M.league.network || {}, name = net.name || 'Blitz Network';
    if (net.logo) return `<img class="net-logo-img" src="${esc(net.logo)}" alt="${esc(name)}">`;
    const n = name.split(' '); return `<b class="net-word"><i>${esc(n[0])}</i> ${esc(n.slice(1).join(' '))}</b>`;
  };

  const PRIZE_LABEL = { champion: 'Champion', runnerUp: 'Runner-up', third: 'Third place', division: 'Division winner', weekly: 'Weekly high score', pointsLeader: 'Points leader', gmOfYear: 'GM of the Year' };

  // ---------- Scroll comfort on phones (every page loads this file) ----------
  // Centre the active item of a sideways-scrolling strip, so the items next to it are in reach.
  function centre(strip, item) {
    if (!strip || !item || strip.scrollWidth <= strip.clientWidth) return;
    const s = strip.getBoundingClientRect(), r = item.getBoundingClientRect();
    strip.scrollLeft += (r.left - s.left) - (s.width - r.width) / 2;
  }
  const nav = document.querySelector('.nav');
  if (nav) requestAnimationFrame(() => centre(nav, nav.querySelector('[aria-current="page"]')));
  // The tab strip is redrawn on every tab change; keep the selected tab in view each time.
  const tabs = document.getElementById('tabs');
  if (tabs) new MutationObserver(() => centre(tabs.querySelector('.wrap'), tabs.querySelector('[aria-selected="true"]'))).observe(tabs, { childList: true });
  // Changing tab (or week) redraws the page below the tabs. If you were scrolled past them, start the new content
  // just under the pinned tab bar; if you were above them, stay put.
  addEventListener('hashchange', () => requestAnimationFrame(() => {
    const hero = document.getElementById('hero'), bar = document.querySelector('.topbar');
    if (!tabs || !tabs.firstElementChild || !hero) return;
    const top = hero.offsetTop + hero.offsetHeight - (bar ? bar.offsetHeight : 0);
    if (scrollY > top) scrollTo({ top });
  }));

  // ---------- Commissioner announcements (sent from account.html) ----------
  // Read straight from the database without signing in (firestore.rules lets anyone read them). Newest first, last 3 weeks.
  const ANN_DAYS = 21, SEEN_KEY = 'blitz.annSeen';
  let annReq = null;
  function announcements(fresh) {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg) return Promise.resolve([]);
    if (annReq && !fresh) return annReq;
    const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/announcements?orderBy=at%20desc&pageSize=5&key=${cfg.apiKey}`;
    const c = new AbortController(), t = setTimeout(() => c.abort(), 6000);
    const cut = Date.now() - ANN_DAYS * 864e5;
    return (annReq = fetch(url, { signal: c.signal, cache: 'no-store' }).then(x => (x.ok ? x.json() : null)).catch(() => null).finally(() => clearTimeout(t))
      .then(r => ((r && r.documents) || []).map(d => ({ id: d.name.split('/').pop(), title: (d.fields.title || {}).stringValue || '',
        body: (d.fields.body || {}).stringValue || '', at: new Date((d.fields.at || {}).timestampValue || 0) })).filter(a => a.title && +a.at > cut)));
  }
  // "Seen" is remembered per device: the ids of announcements this phone or computer has already shown.
  const seen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch (e) { return []; } };
  function markSeen(ids) {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...ids, ...seen()])].slice(0, 50))); } catch (e) { /* private mode: it shows again next time */ }
  }
  const annTime = at => at.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  // Any announcement this device hasn't seen yet pops up once, over whatever page is open.
  // Private messages (js/notes.js) need the sign-in code, which is only loaded where someone has signed in.
  let notesMod = null;
  function privateNotes() {
    let on = false;
    try { on = localStorage.getItem('blitz.signedIn') === '1'; } catch (e) { /* private mode */ }
    const src = (document.querySelector('meta[name="blitz-notes"]') || {}).content;
    if (!on || !src || !window.FIREBASE_CONFIG) return Promise.resolve([]);
    notesMod = notesMod || import(new URL(src, document.baseURI).href);
    return notesMod.then(m => m.mine()).catch(e => (console.error(e), []));
  }
  // Open trade offers to the signed-in GM's team, shown first in the popup as a trade alert (each one once per device).
  async function tradeOffers() {
    let on = false;
    try { on = localStorage.getItem('blitz.signedIn') === '1'; } catch (e) { /* private mode */ }
    const src = (document.querySelector('meta[name="blitz-notes"]') || {}).content;
    if (!on || !src || !window.FIREBASE_CONFIG) return [];
    notesMod = notesMod || import(new URL(src, document.baseURI).href);
    const list = await notesMod.then(m => (m.offers ? m.offers() : [])).catch(e => (console.error(e), []));
    if (!list.length) return [];
    const M = window.Hub ? await Hub.load().catch(() => null) : null;
    const nm = id => (M && M.teams[id] ? teamName(M.teams[id]) : `Team ${id}`);
    return list.map(t => ({ ...t, title: '🚨TRADE ALERT🚨', body: `${nm(t.from)} ${t.counter ? 'countered your offer' : 'sent you a trade offer'}.`, href: `team.html?team=${t.team}#trades` }));
  }
  // "My team" in the top bar: the signed-in GM's franchise, with quick links (hover on desktop). Remembered on this
  // device so it shows at once; checked again against the account on every page load.
  const MY_KEY = 'blitz.myTeam';
  function myTeam(M) {
    const el = document.getElementById('my-team'); if (!el || !M) return;
    const draw = id => {
      const t = id != null && M.teams[id];
      if (!t) { el.hidden = true; el.innerHTML = ''; return; }
      const here = location.pathname.endsWith('team.html') && +new URLSearchParams(location.search).get('team') === t.id;
      el.innerHTML = `<a href="team.html?team=${t.id}" class="my-team-a"${here ? ' aria-current="page"' : ''} title="${esc(teamName(t))}">${markSVG(t.f, 'mini')}<span>My team</span></a>
        <div class="nav-sub"><a href="team.html?team=${t.id}">Overview</a><a href="team.html?team=${t.id}#depth-chart">Lineup</a><a href="team.html?team=${t.id}#roster">Roster</a><a href="matchup.html">This week's matchup</a></div>`;
      el.hidden = false;
    };
    let cached = null; try { cached = JSON.parse(localStorage.getItem(MY_KEY) || 'null'); } catch (e) { /* private mode */ }
    if (cached != null) draw(cached);
    let on = false; try { on = localStorage.getItem('blitz.signedIn') === '1'; } catch (e) { /* private mode */ }
    const src = (document.querySelector('meta[name="blitz-notes"]') || {}).content;
    if (!on || !src || !window.FIREBASE_CONFIG) { if (!on) { draw(null); try { localStorage.removeItem(MY_KEY); } catch (e) { /* */ } } return; }
    notesMod = notesMod || import(new URL(src, document.baseURI).href);
    // Roster moves (Add / Claim / Drop on player cards, budget and claims on Network > Players) for signed-in GMs.
    const mv = (document.querySelector('meta[name="blitz-moves"]') || {}).content;
    if (M.hub && mv) import(new URL(mv, document.baseURI).href).catch(e => console.error(e));
    const tm = (document.querySelector('meta[name="blitz-trades"]') || {}).content;
    if (M.hub && tm) import(new URL(tm, document.baseURI).href).catch(e => console.error(e));
    notesMod.then(m => m.myTeam()).then(id => { try { localStorage.setItem(MY_KEY, JSON.stringify(id)); } catch (e) { /* */ } if (id !== cached) draw(id); }).catch(() => {});
  }

  async function unreadPopup(fresh) {
    if (window.top !== window || document.getElementById('ann-pop')) return;
    const s = new Set(seen());
    const [pub, mine, offers] = await Promise.all([announcements(fresh), privateNotes(), tradeOffers()]);
    const list = [...offers.filter(a => !s.has(a.id)), ...[...mine, ...pub].filter(a => !s.has(a.id)).sort((a, b) => b.at - a.at)];
    if (!list.length || document.getElementById('ann-pop')) return;
    const el = document.createElement('div');
    el.id = 'ann-pop'; el.className = 'ann-pop';
    el.innerHTML = `<div class="ann-card" role="dialog" aria-modal="true" aria-labelledby="ann-pop-h">
      <span class="eyebrow">${list.every(a => a.trade) ? 'Trades' : list.some(a => a.trade) ? 'While you were away' : 'From the commissioner'}</span><h2 id="ann-pop-h">${list.length > 1 ? `${list.length} new messages` : list[0].trade ? 'New trade offer' : list[0].private ? 'A message for you' : 'New announcement'}</h2>
      <div class="ann-list">${list.map(a => `<article class="ann${a.private ? ' private' : ''}${a.trade ? ' trade' : ''}"><b>${esc(a.title)}</b><p>${esc(a.body)}</p><span class="pmeta">${annTime(a.at)}</span>${a.href ? `<a class="btn small primary ann-go" href="${esc(a.href)}">Review trade</a>` : ''}</article>`).join('')}</div>
      <button class="btn primary" type="button">Got it</button></div>`;
    const close = () => { markSeen(list.map(a => a.id)); el.remove(); document.removeEventListener('keydown', esc_); };
    const esc_ = e => { if (e.key === 'Escape') close(); };
    el.querySelector('button').onclick = close;
    for (const a of el.querySelectorAll('.ann-go')) a.onclick = () => markSeen(list.map(x => x.id));   // going to review it counts as seen
    el.onclick = e => { if (e.target === el) close(); };
    document.addEventListener('keydown', esc_);
    document.body.appendChild(el);
    el.querySelector('button').focus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => unreadPopup()); else unreadPopup();
  // A notification that arrives while the site is open on screen: sw.js tells the page, and it pops up at once.
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && (e.data.kind === 'announcement' || e.data.kind === 'note' || e.data.kind === 'trade')) setTimeout(() => unreadPopup(true), 800);
  });

  /* ---------- Staying current in the installed app (it has no reload button) ----------
     1. Update banner: version.json (written by tools/make_pages.py) names the newest version of the site's code; this page
        knows the version it was built with (meta blitz-version). Checked when the app comes back on screen and every 5
        minutes; when they differ, a banner offers a one-tap refresh.
     2. Pull to refresh: in the installed app, drag down from the very top of the page and let go to reload it. Ignored
        when the drag starts inside something that scrolls by itself (a list, a table, a dialog). */
  (function freshness() {
    const mine = (document.querySelector('meta[name="blitz-version"]') || {}).content;
    let shown = false, last = 0;
    async function check() {
      if (!mine || shown || Date.now() - last < 10000) return; last = Date.now();
      try {
        const v = (await (await fetch('version.json', { cache: 'no-store' })).json()).v;
        if (!v || v === mine) return;
        shown = true;
        const b = document.createElement('div'); b.id = 'upd-bar';
        b.innerHTML = '<span>Blitz Hub was updated.</span><button class="btn primary" type="button">Refresh</button><button class="upd-x" type="button" aria-label="Later">&times;</button>';
        b.querySelector('.btn').onclick = () => location.reload();
        b.querySelector('.upd-x').onclick = () => b.remove();
        document.body.appendChild(b);
      } catch (e) { /* offline: try again later */ }
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 5 * 60000); setTimeout(check, 5000);

    const app = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (!app) return;
    // Only a deliberate, straight-down drag counts: it must start below the menu and tab bars (not on anything that
    // scrolls sideways), stay mostly vertical the whole way (any sideways swipe cancels it), and go about 140px.
    const NEED = 140;
    let y0 = null, x0 = 0, pull = 0, pill = null;
    const inner = el => { for (; el && el !== document.body; el = el.parentElement) {
      if (el.tagName === 'DIALOG' || el.matches('.topbar, #tabs, .tabs, nav, .weekstrip, [role="tablist"]')) return true;
      const cs = getComputedStyle(el), oy = cs.overflowY, ox = cs.overflowX;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight && el.scrollTop > 0) return true;
      if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) return true; } return false; };
    const stop = () => { if (pill) { pill.remove(); pill = null; } y0 = null; pull = 0; };
    addEventListener('touchstart', e => { const t = e.touches[0]; y0 = scrollY <= 0 && e.touches.length === 1 && !inner(e.target) && !document.querySelector('dialog[open]') ? t.clientY : null; x0 = t.clientX; pull = 0; }, { passive: true });
    addEventListener('touchmove', e => {
      if (y0 == null) return;
      const t = e.touches[0], dy = t.clientY - y0, dx = Math.abs(t.clientX - x0);
      if (scrollY > 0 || dx > 24 || dx > dy * 0.5) { stop(); return; }
      pull = Math.max(0, dy);
      if (!pill && pull > 30) { pill = document.createElement('div'); pill.id = 'ptr'; document.body.appendChild(pill); }
      if (pill) { const d = Math.min(pull, 200); pill.style.transform = `translate(-50%, ${d * 0.5}px)`; pill.style.opacity = Math.min(1, d / NEED); pill.textContent = pull > NEED ? 'Release to refresh' : 'Pull to refresh'; pill.classList.toggle('go', pull > NEED); }
    }, { passive: true });
    addEventListener('touchend', () => { if (pill && pull > NEED) { pill.textContent = 'Refreshing…'; location.reload(); return; } stop(); });
    addEventListener('touchcancel', stop);
  })();

  window.UI = { myTeam, announcements, markSeen, annTime, POS_ORDER, pid, divInk, SIL, esc, f1, f2, ord, SLOT_LABEL, SLOT_SHORT, lum, shot, teamName, rec, status, pmeta, wash, accentFor, applyColors, primaryLogo, matchupLogo, leagueHero, tabsHTML, boot, badge, allGames, money, cash, honorOnly, prizes, weeklyWinners, PRIZE_LABEL, line, oddsHTML, billingHTML, broadcastHTML, netWord, mlTxt };
})();
