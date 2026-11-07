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

  function status(p) {
    const s = p.injury_status;
    if (!s) return '';
    const cls = { Out: 'out', IR: 'ir', PUP: 'ir', Sus: 'out', Questionable: 'q', Doubtful: 'd' }[s] || 'q';
    const label = { Questionable: 'Q', Doubtful: 'D' }[s] || s;
    return `<span class="tag ${cls}" title="${esc(s)}${p.injury_body_part ? ' · ' + esc(p.injury_body_part) : ''}">${esc(label)}</span>`;
  }
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

  // League-page header: shield, title, one-line summary, division marks.
  function leagueHero(M, eyebrow, title, sub) {
    const lg = M.league;
    return `<section class="lhero">${lg.logo ? `<img class="hero-watermark" src="${esc(lg.logo)}" alt="" aria-hidden="true">` : ''}<div class="wrap">
      ${lg.logo ? `<img class="lhero-logo" src="${esc(lg.logo)}" alt="${esc(lg.name)}">` : ''}
      <div><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1>${sub ? `<div class="nick">${sub}</div>` : ''}</div>
      <div class="lhero-divs">${lg.divisions.map(d => `<div>${divMarkHTML(d, 'divmark divmark-lg')}<span>${esc(d.name)}</span></div>`).join('')}</div>
    </div></section>`;
  }

  const tabsHTML = (tabs, cur) => `<div class="tabs"><div class="wrap" role="tablist">${tabs.map(([id, l]) =>
    `<a class="tab" role="tab" href="#${id}" aria-selected="${id === cur}">${esc(l)}</a>`).join('')}</div></div>`;

  // Shared page start: load the model, fill the top bar, then hand over. Errors land in the page, not just the console.
  async function boot(crumb, run) {
    try {
      const M = await Hub.load();
      document.getElementById('sample-flag').hidden = M.live;
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
    if (L.division && L.division === R.division) {
      tags.push(`<b style="--tc:${divInk(L.division)}">${esc(L.division.name)} game</b>`);
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

  const PRIZE_LABEL = { champion: 'Champion', runnerUp: 'Runner-up', division: 'Division winner', weekly: 'Weekly high score', pointsLeader: 'Points leader', gmOfYear: 'GM of the Year' };

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

  window.UI = { POS_ORDER, pid, divInk, SIL, esc, f1, f2, ord, SLOT_LABEL, SLOT_SHORT, lum, shot, teamName, rec, status, pmeta, wash, accentFor, applyColors, primaryLogo, leagueHero, tabsHTML, boot, allGames, money, cash, honorOnly, prizes, weeklyWinners, PRIZE_LABEL, line, oddsHTML, billingHTML, broadcastHTML, netWord, mlTxt };
})();
