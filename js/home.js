/* League home: this week's games (with broadcast and line), the Blitz Network (data/news.json stories, ESPN headlines
   naming Blitz players via js/nfl.js, and an automatic wire written from league results), last week's awards, standings snapshot, latest moves, franchise directory. */
(function () {
  const { esc, f1, f2, ord, rec, teamName, wash, accentFor, primaryLogo } = UI;
  let M;
  const P = id => M.players[id] || { full_name: `Player ${id}`, position: '?' };
  const order = (a, b) => (b.wins - a.wins) || (b.pf - a.pf);
  const mlink = (w, id) => `matchup.html#w${w}-t${id}`;
  const state = g => (g.final ? 'final' : g.live ? 'live' : 'upcoming');

  function gamesFor(week) {
    const seen = new Set(), out = [];
    for (const t of Object.values(M.teams).sort(order)) {
      const g = t.games.find(x => x.week === week);
      if (!g || !g.opp || seen.has(t.id)) continue;
      seen.add(t.id); seen.add(g.opp.id); out.push(g);
    }
    return out;
  }

  function hero() {
    const lg = M.league;
    return `<section class="lhero home"><div class="wrap">
      ${lg.logo ? `<img class="lhero-logo big" src="${esc(lg.logo)}" alt="${esc(lg.name)}">` : ''}
      <div><span class="eyebrow">${esc(M.state.season)} season · Week ${M.current}</span><h1>${esc(lg.name)}</h1>
      <div class="nick">${Object.keys(M.teams).length} franchises · ${lg.divisions.length} divisions · Dynasty on Sleeper</div></div>
      <div class="lhero-divs">${lg.divisions.map(d => `<div>${divMarkHTML(d, 'divmark divmark-lg')}</div>`).join('')}</div>
    </div></section>`;
  }

  // ---------- Showcase: the rotating feature at the top of "This week" ----------
  // One slide per game this week (game of the week first: most combined wins, then most combined points for), with the
  // award races mixed in. Advances every 10 seconds; arrows, dots, arrow keys and swipes move it by hand. Hovering or
  // focusing it pauses, and it holds still for anyone with reduced motion turned on.
  const SHOW_MS = 10000;
  const OFF = ['QB', 'RB', 'WR', 'TE'], DEF = ['DL', 'LB', 'DB'];
  const byWins = (a, b) => ((M.teams[b.me.roster_id].wins + b.opp.wins) - (M.teams[a.me.roster_id].wins + a.opp.wins))
    || (M.teams[b.me.roster_id].pf + b.opp.pf - M.teams[a.me.roster_id].pf - a.opp.pf);

  function lastGame(t) {
    const g = t.games.filter(x => x.final && x.opp).pop();
    return g ? `${g.result} ${f1(g.me.points)}-${f1(g.oppRow.points)} vs ${esc(g.opp.f.abbr || g.opp.f.location)}` : '';
  }
  function streakTxt(t) {
    const n = +String(t.streak).slice(1), k = String(t.streak)[0];
    return n >= 2 && (k === 'W' || k === 'L') ? `${k === 'W' ? 'Won' : 'Lost'} ${n} straight` : '';
  }

  function matchSlide(g, gotw) {
    const L = M.teams[g.me.roster_id], R = g.opp, st = state(g), l = UI.line(M, g);
    const ab = t => esc(t.f.abbr || t.f.location);
    const plate = (t, side) => `<div class="sc-plate ${side}"><b><i>#${t.leagueRank}</i> ${esc(t.f.location)}</b>
      <small>${[rec(t), streakTxt(t) || lastGame(t)].filter(Boolean).join(' · ')}</small></div>`;
    const score = st === 'upcoming' ? `<b>Week ${g.week}</b><small>Upcoming</small>`
      : `<b>${f2(g.me.points)} <span>-</span> ${f2(g.oppRow.points)}</b><small class="${st}">${st === 'final' ? 'Final' : 'Live'}${st === 'live' ? '<i></i>' : ''} · Week ${g.week}</small>`;
    const odds = l ? `<b>${l.spread ? `${ab(l.fav)} −${l.spread}` : 'Pick’em'}</b><small>${g.final ? 'Closing line' : 'Spread'} · O/U ${l.total}</small>` : '<b>Off</b><small>Lines open after week 1</small>';
    return `<a class="slide match" href="${mlink(g.week, L.id)}" style="--lw:${wash(L.f)};--rw:${wash(R.f)};--lc:${accentFor(L.f)};--rc:${accentFor(R.f)}">
      <span class="sc-tag">${gotw ? 'Game of the week' : `Week ${g.week} matchup`}</span>
      <div class="sc-side l">${helmetHTML(L.f, { facing: 'right', variant: 'home' })}${plate(L, 'l')}</div>
      <div class="sc-mid">
        <div class="sc-net">${UI.netWord(M)}</div>
        ${UI.billingHTML(M, g, { tagsOnly: true }) || `<span class="sc-kick">${gotw ? 'Most combined wins this week' : `Week ${g.week}`}</span>`}
        <h3 class="sc-team"><i>#${L.leagueRank}</i> ${esc(L.f.location)}</h3>
        <span class="sc-vs">vs</span>
        <h3 class="sc-team"><i>#${R.leagueRank}</i> ${esc(R.f.location)}</h3>
        <div class="sc-strip"><div>${score}</div><div>${odds}</div></div>
      </div>
      <div class="sc-side r">${helmetHTML(R.f, { facing: 'left', variant: 'away' })}${plate(R, 'r')}</div>
    </a>`;
  }

  // Award race: a trophy beside the current top four. rows: [{ f, shot?, name, sub, val, unit }].
  function raceSlide({ href, art, title, sub, rows }) {
    return `<a class="slide race" href="${href}">
      <div class="race-art">${art ? `<img src="${esc(art)}" alt="">` : ''}</div>
      <div class="race-body"><h3>${title}</h3><span class="race-sub">${sub}</span>
        <ol>${rows.map((r, i) => `<li><span class="race-rk">${i + 1}</span>${markSVG(r.f, 'race-mark')}${r.shot ? UI.shot(r.shot, 'race-shot') : ''}
          <div class="race-who"><b>${r.name}</b><small>${r.sub}</small></div><span class="race-v">${r.val}<small>${r.unit}</small></span></li>`).join('')}</ol></div>
    </a>`;
  }

  // Points each player has scored in finished games, credited to the team that started him most recently.
  function playerRace(groups, only) {
    const tot = {};
    for (const t of Object.values(M.teams)) for (const g of t.games.filter(x => x.final)) (g.me.starters || []).forEach((id, i) => {
      if (!id || id === '0' || !groups.includes(P(id).position) || (only && !only(P(id)))) return;
      const p = tot[id] || (tot[id] = { id, v: 0, t, wk: 0 });
      p.v += (g.me.starters_points || [])[i] || 0;
      if (g.week >= p.wk) { p.wk = g.week; p.t = t; }
    });
    return Object.values(tot).sort((a, b) => b.v - a.v).slice(0, 4)
      .map(p => ({ f: p.t.f, shot: p.id, name: esc(P(p.id).full_name), sub: `${esc(P(p.id).nflPos || P(p.id).position)} · ${esc(p.t.f.location)}`, val: f1(p.v), unit: 'pts' }));
  }

  function showcase(games) {
    if (!games.length) return '';
    const ranked = games.slice().sort(byWins), through = M.current - 1, trophies = M.league.awardTrophies || {};
    const races = [];
    if (through >= 1) {
      const off = playerRace(OFF), def = playerRace(DEF);
      if (off.length) races.push(raceSlide({ href: 'awards.html#players', art: trophies.opoy, title: 'Offensive Player<br>of the Year', sub: `Current top four · through week ${through}`, rows: off }));
      races.push(raceSlide({ href: 'standings.html', art: M.league.trophy, title: 'Race for<br>the Gauntlet', sub: `Best records · through week ${through}`,
        rows: Object.values(M.teams).sort(order).slice(0, 4).map(t => ({ f: t.f, name: esc(t.f.location), sub: `${esc(t.division.name)} · ${f1(t.pf)} PF`, val: rec(t), unit: '' })) }));
      if (def.length) races.push(raceSlide({ href: 'awards.html#players', art: trophies.dpoy, title: 'Defensive Player<br>of the Year', sub: `Current top four · through week ${through}`, rows: def }));
      const roy = playerRace([...OFF, ...DEF], p => p.years_exp === 0);
      if (roy.length) races.push(raceSlide({ href: 'awards.html#players', art: trophies.roy, title: 'Rookie<br>of the Year', sub: `Current top four · through week ${through}`, rows: roy }));
    }
    // Game of the week, then a race after every second game, so the races spread through the rotation.
    const slides = [];
    ranked.forEach((g, i) => { slides.push(matchSlide(g, i === 0)); if (i % 2 === 0 && races.length) slides.push(races.shift()); });
    slides.push(...races);
    return `<section class="show" aria-roledescription="carousel" aria-label="Featured this week" tabindex="0">
      <div class="show-track">${slides.map((s, i) => s.replace('<a class="slide', `<a aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}" class="slide${i === 0 ? ' on' : ''}`)).join('')}</div>
      ${slides.length > 1 ? `<button class="show-nav prev" type="button" aria-label="Previous">&#8249;</button><button class="show-nav next" type="button" aria-label="Next">&#8250;</button>
      <div class="show-dots">${slides.map((_, i) => `<button type="button" aria-label="Show slide ${i + 1}"${i === 0 ? ' class="on" aria-current="true"' : ''}><i></i></button>`).join('')}</div>` : ''}
    </section>`;
  }

  function rotate(root) {
    if (!root) return;
    const slides = [...root.querySelectorAll('.slide')], dots = [...root.querySelectorAll('.show-dots button')];
    if (slides.length < 2) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let at = 0, timer = 0, hold = false;
    const arm = () => {
      clearTimeout(timer); root.classList.remove('run');
      if (hold || still || document.hidden) return;
      void root.offsetWidth;                     // restart the progress bar on the active dot
      root.classList.add('run'); timer = setTimeout(() => go(at + 1), SHOW_MS);
    };
    function go(n) {
      at = (n + slides.length) % slides.length;
      slides.forEach((s, k) => { s.classList.toggle('on', k === at); s.inert = k !== at; });
      dots.forEach((d, k) => { d.classList.toggle('on', k === at); d.setAttribute('aria-current', k === at ? 'true' : 'false'); });
      arm();
    }
    slides.forEach((s, k) => (s.inert = k !== 0));
    root.querySelector('.prev').onclick = () => go(at - 1);
    root.querySelector('.next').onclick = () => go(at + 1);
    dots.forEach((d, k) => (d.onclick = () => go(k)));
    root.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') go(at - 1); else if (e.key === 'ArrowRight') go(at + 1); });
    const pause = v => () => { hold = v; arm(); };
    root.addEventListener('mouseenter', pause(true)); root.addEventListener('mouseleave', pause(false));
    root.addEventListener('focusin', pause(true)); root.addEventListener('focusout', e => { if (!root.contains(e.relatedTarget)) pause(false)(); });
    document.addEventListener('visibilitychange', arm);
    let x0 = null;
    root.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) go(at + (dx < 0 ? 1 : -1)); });
    arm();
  }

  function scoreboard(games) {
    return `<div class="board">${games.map(g => {
      const L = M.teams[g.me.roster_id], R = g.opp, st = state(g), a = g.me.points, b = g.oppRow.points;
      const line = (t, v, win) => `<div class="bline${win ? ' win' : ''}">${markSVG(t.f, 'mini')}<span>${esc(t.f.location)}</span><small>${rec(t)}</small><b>${st === 'upcoming' ? '' : f1(v)}</b></div>`;
      return `<a class="bcard" href="${mlink(g.week, L.id)}"><span class="bstate ${st}">${st === 'final' ? 'Final' : st === 'live' ? 'Live' : 'Upcoming'}</span>
        ${line(L, a, st !== 'upcoming' && a > b)}${line(R, b, st !== 'upcoming' && b > a)}${st === 'final' ? '' : UI.oddsHTML(M, g, true)}</a>`;
    }).join('')}</div>`;
  }

  function awards() {
    const w = M.current - 1;
    if (w < 1) return '<div class="empty">Awards start after week 1.</div>';
    const games = gamesFor(w);
    const scores = games.flatMap(g => [{ t: M.teams[g.me.roster_id], p: g.me.points, g }, { t: g.opp, p: g.oppRow.points, g }]);
    const hi = scores.reduce((a, b) => (b.p > a.p ? b : a)), lo = scores.reduce((a, b) => (b.p < a.p ? b : a));
    const margin = g => Math.abs(g.me.points - g.oppRow.points);
    const close = games.reduce((a, b) => (margin(b) < margin(a) ? b : a)), blow = games.reduce((a, b) => (margin(b) > margin(a) ? b : a));
    let top = null;
    for (const g of games) for (const row of [g.me, g.oppRow]) (row.starters || []).forEach((id, i) => {
      const v = (row.starters_points || [])[i];
      if (v != null && (!top || v > top.v)) top = { id, v, t: M.teams[row.roster_id] };
    });
    const wk = UI.weeklyWinners(M).find(x => x.week === w);   // the week's prize (regular season only)
    const winner = g => (g.me.points >= g.oppRow.points ? M.teams[g.me.roster_id] : g.opp);
    const loser = g => (g.me.points >= g.oppRow.points ? g.opp : M.teams[g.me.roster_id]);
    const card = (lbl, big, who, sub, href, f, prize) => `<a class="award" href="${href}">${f ? markSVG(f, 'mini') : ''}<div><span class="lbl">${lbl}${prize || ''}</span><span class="big">${big}</span><span class="who">${who}</span>${sub ? `<span class="pmeta">${sub}</span>` : ''}</div></a>`;
    return `<div class="awards">
      ${card('High score', f2(hi.p), esc(hi.t.f.location), wk && wk.winners.length > 1 ? `Tied with ${wk.winners.filter(t => t !== hi.t).map(t => esc(t.f.location)).join(', ')}` : '', mlink(w, hi.t.id), hi.t.f, wk ? UI.cash(wk.each) : '')}
      ${card('Top performer', f2(top.v), esc(P(top.id).full_name), `${esc(P(top.id).position)} · ${esc(top.t.f.location)}`, mlink(w, top.t.id), top.t.f)}
      ${card('Closest game', f2(margin(close)), `${esc(winner(close).f.location)} over ${esc(loser(close).f.location)}`, '', mlink(w, close.me.roster_id), winner(close).f)}
      ${card('Biggest blowout', f2(margin(blow)), `${esc(winner(blow).f.location)} over ${esc(loser(blow).f.location)}`, '', mlink(w, blow.me.roster_id), winner(blow).f)}
      ${card('Low score', f2(lo.p), esc(lo.t.f.location), '', mlink(w, lo.t.id), lo.t.f)}
    </div>`;
  }

  // ---------- Blitz Network ----------
  // Wire stories written from results: nothing here is invented, each one is a fact from the league data.
  function wire() {
    const out = [], w = M.current - 1, loc = t => esc(t.f.location);
    if (w >= 1) {
      const games = gamesFor(w).filter(g => g.final);
      const wk = M.weekly.find(x => x.week === w), z = UI.prizes(M);
      if (wk) out.push({ tag: 'Recap', t: wk.winners[0], href: mlink(w, wk.winners[0].id),
        head: `${wk.winners.map(loc).join(' and ')} ${wk.winners.length > 1 ? 'share' : 'posts'} week ${w}'s top score`,
        dek: `${f2(wk.points)} points${z.weekly ? `, worth ${UI.money(z.weekly / wk.winners.length)} from the weekly prize` : ''}.` });
      let up = null;
      for (const g of games) {
        const l = UI.line(M, g), a = g.me.points, b = g.oppRow.points;
        if (!l || !l.spread || a === b) continue;
        const win = a > b ? l.L : l.R;
        if (win === l.dog && l.spread >= 3 && (!up || l.spread > up.l.spread)) up = { g, l };   // a real upset: 3+ point underdog
      }
      if (up) out.push({ tag: 'Upset', t: up.l.dog, href: mlink(w, up.l.dog.id),
        head: `${loc(up.l.dog)} stuns ${loc(up.l.fav)} as a ${up.l.spread}-point underdog`,
        dek: `Final ${f2(Math.max(up.g.me.points, up.g.oppRow.points))} to ${f2(Math.min(up.g.me.points, up.g.oppRow.points))} in week ${w}.` });
      const m = g => Math.abs(g.me.points - g.oppRow.points);
      if (games.length) { const g = games.reduce((a, b) => (m(b) > m(a) ? b : a)), win = g.me.points > g.oppRow.points ? M.teams[g.me.roster_id] : g.opp, lose = win === g.opp ? M.teams[g.me.roster_id] : g.opp;
        out.push({ tag: 'Recap', t: win, href: mlink(w, win.id), head: `${loc(win)} routs ${loc(lose)} by ${f1(m(g))}`, dek: `The biggest margin of week ${w}.` }); }
    }
    const tr = M.transactions.find(x => x.type === 'trade' && (!x.status || x.status === 'complete'));
    if (tr) { const ts = tr.roster_ids.map(r => M.teams[r]).filter(Boolean), moved = Object.keys(tr.adds || {}).map(id => esc(P(id).full_name));
      if (ts.length > 1) out.push({ tag: 'Trade', t: ts[0], href: `team.html?team=${ts[0].id}#transactions`, head: `${ts.map(loc).join(' and ')} strike a deal`,
        dek: `${moved.slice(0, 3).join(', ')}${moved.length > 3 ? ' and more' : ''} on the move${tr.leg ? ` in week ${tr.leg}` : ''}.` }); }
    const hot = Object.values(M.teams).filter(t => /^W\d+$/.test(t.streak) && +t.streak.slice(1) >= 3).sort((a, b) => b.streak.slice(1) - a.streak.slice(1))[0];
    if (hot) out.push({ tag: 'Streak', t: hot, href: `team.html?team=${hot.id}#schedule`, head: `${loc(hot)} has won ${hot.streak.slice(1)} straight`,
      dek: `${rec(hot)}, ${ord(hot.divRank)} in ${esc(hot.division.name)}.` });
    const now = gamesFor(M.current), gotw = now.length ? now.slice().sort((a, b) => (M.teams[b.me.roster_id].wins + b.opp.wins) - (M.teams[a.me.roster_id].wins + a.opp.wins))[0] : null, l = gotw && UI.line(M, gotw);
    if (l) out.unshift({ tag: 'Preview', t: l.fav, href: mlink(gotw.week, l.L.id), head: `${loc(l.L)} vs ${loc(l.R)}: ${l.spread ? `${loc(l.fav)} favored by ${l.spread}` : 'a pick’em'}`,
      dek: `Week ${gotw.week}'s game of the week. Over/under ${l.total}.` });
    return out;
  }

  // ESPN headlines that name Blitz-rostered players (js/nfl.js), newest first, shaped like the stories above.
  function nflStories(N) {
    if (!N) return [];
    const T = { HeadlineNews: 'NFL news', Story: 'NFL story', Media: 'NFL video' };
    return N.news.filter(n => n.blitz.length).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 4).map(n => {
      const b = n.blitz[0];
      return { tag: T[n.type] || 'NFL', head: esc(n.head), href: n.url || '', ext: true, shot: b.id, t: b.t, byline: ['ESPN', n.byline].filter(Boolean).join(' · '),
        dek: `${n.blitz.slice(0, 3).map(x => `${esc(P(x.id).full_name)} (${esc(x.t.f.location)})`).join(', ')}${n.blitz.length > 3 ? ` and ${n.blitz.length - 3} more` : ''}` };
    });
  }

  function network(news, N) {
    const stories = (news.stories || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map(s => ({ tag: s.tag || 'News', head: esc(s.headline), dek: esc(s.dek || ''), href: s.url || '', image: s.image, byline: s.byline, date: s.date, breaking: s.breaking, t: (s.teams || []).map(r => M.teams[r]).find(Boolean) }));
    const nfl = nflStories(N), lw = wire();
    const all = [...stories, ...nfl.slice(0, 1), ...lw.slice(0, 2), ...nfl.slice(1), ...lw.slice(2)];
    const hurt = N ? new Set(N.injuries.filter(x => x.own && x.own.where === 'starter' && ['Out', 'Doubtful', 'Injured Reserve'].includes(x.status)).map(x => x.pid)) : new Set();
    const alerts = N ? N.starters.filter(s => s.bye || hurt.has(s.id)).length : 0;
    if (!all.length) return '';
    const breaking = stories.filter(s => s.breaking);
    const [lead, ...rest] = all;
    const art = s => (s.image ? `<img class="net-img" src="${esc(s.image)}" alt="">` : s.shot ? UI.shot(s.shot, 'nw-lead-shot') : s.t ? primaryLogo(s.t.f, 'net-logo') : `<img class="net-logo" src="${esc((M.league.network || {}).mark || M.league.logo)}" alt="">`);
    const meta = s => [s.byline ? esc(s.byline) : s.date ? '' : 'Blitz Network Wire', s.date ? esc(s.date) : ''].filter(Boolean).join(' · ');
    const tag = s => `<span class="net-tag${s.breaking || /breaking/i.test(s.tag) ? ' hot' : ''}">${esc(s.tag)}</span>`;
    const a = (s, cls, inner) => (s.href ? `<a class="${cls}" href="${esc(s.href)}"${s.ext ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>` : `<div class="${cls}">${inner}</div>`);
    return `<section class="panel s12 network">
      ${breaking.length ? `<div class="ticker"><b>Breaking</b><span>${breaking.map(s => s.head).join(' <i>/</i> ')}</span></div>` : ''}
      <header><div><span class="eyebrow">NFL news, recaps and the wire</span><h2>${UI.netWord(M)}</h2></div><a class="aside" href="network.html">Full coverage</a></header>
      ${alerts ? `<a class="net-alert" href="network.html#matchups"><b>${alerts} lineup alert${alerts > 1 ? 's' : ''}</b><span>Blitz starters on bye, out, doubtful or on IR this week</span><i>&rsaquo;</i></a>` : ''}
      <div class="net-grid">
        ${a(lead, 'net-lead', `<div class="net-art" style="${lead.t ? `--lw:${wash(lead.t.f)}` : ''}">${art(lead)}</div><div class="net-copy">${tag(lead)}<h3>${lead.head}</h3><p>${lead.dek}</p><span class="pmeta">${meta(lead)}</span></div>`)}
        <div class="net-list">${rest.slice(0, 5).map(s => a(s, 'net-item', `${s.shot ? UI.shot(s.shot, 'mini net-shot') : s.t ? markSVG(s.t.f, 'mini') : (M.league.network || {}).mark ? `<img class="mini net-mark" src="${esc(M.league.network.mark)}" alt="">` : ''}<div>${tag(s)}<b>${s.head}</b><span class="pmeta">${s.dek}</span></div>`)).join('')}</div>
      </div>
      <div class="net-more">${['headlines:Headlines', 'players:Players', 'injuries:Injury report', 'matchups:Matchups', 'defenses:Defense vs position', 'slate:NFL slate', 'trending:Trending', 'rookies:Rookies & College'].map(x => x.split(':')).map(([h, l]) => `<a href="network.html#${h}">${l}</a>`).join('')}</div>
      <p class="footnote">NFL stories are ESPN headlines that name Blitz-rostered players, linked to ESPN. Wire stories are written automatically from league results. Blitz Network stories and breaking news go in data/news.json.</p>
    </section>`;
  }

  function snapshot() {
    return `<div class="snap">${M.league.divisions.map(d => {
      const teams = Object.values(M.teams).filter(t => t.division === d).sort(order);
      return `<div class="snapdiv" style="--dc:${UI.divInk(d)}"><div class="sub">${divMarkHTML(d)}${esc(d.name)}</div>
        ${teams.map((t, i) => `<a class="snaprow" href="team.html?team=${t.id}"><span class="rk">${i + 1}</span>${markSVG(t.f, 'mini')}<span class="nm">${esc(t.f.location)}</span><b>${rec(t)}</b></a>`).join('')}</div>`;
    }).join('')}</div>`;
  }

  function moves() {
    const list = M.transactions.slice(0, 5);
    if (!list.length) return '<div class="empty">No moves yet.</div>';
    const label = { trade: 'Trade', waiver: 'Waiver', free_agent: 'Free agent' };
    return `<div class="plist">${list.map(x => {
      const d = new Date(x.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const teams = x.roster_ids.map(r => M.teams[r]).filter(Boolean);
      const adds = Object.entries(x.adds || {}).map(([id, r]) => `<span class="mv"${UI.pid(id)}><span class="sign add">+</span>${esc(P(id).full_name)}${x.type === 'trade' ? ` <small>to ${esc(M.teams[r].f.location)}</small>` : ''}</span>`).join('');
      return `<div class="hmove"><div class="when"><span class="tag ${esc(x.type)}">${label[x.type] || esc(x.type)}</span><span>${esc(d)}</span></div>
        <div class="who">${teams.map(t => `<a href="team.html?team=${t.id}">${markSVG(t.f, 'mini')} ${esc(t.f.location)}</a>`).join('<span class="x">&harr;</span>')}</div>
        <div class="moves">${adds}</div></div>`;
    }).join('')}</div>`;
  }

  function directory() {
    return `<div class="dir">${M.league.divisions.flatMap(d => Object.values(M.teams).filter(t => t.division === d).sort((a, b) => a.f.location.localeCompare(b.f.location))).map(t =>
      `<a class="dcard" href="team.html?team=${t.id}" style="--lw:${wash(t.f)};--lc:${accentFor(t.f)}">${primaryLogo(t.f, 'dlogo')}
        <b>${esc(t.f.location)}</b><small>${t.f.nickname ? esc(t.f.nickname) : 'Name to be decided'}</small><span class="pmeta">${esc(t.division.name)} · ${rec(t)}</span></a>`).join('')}</div>`;
  }

  // The commissioner's announcements (sent from account.html), read straight from the database without signing in.
  // Shown at the top of the page for three weeks; nothing is shown if there are none or the database can't be reached.
  async function announcements() {
    const list = (await UI.announcements()).slice(0, 3);
    const grid = document.querySelector('#content > .grid');
    if (!list.length || !grid || document.getElementById('announcements')) return;
    grid.insertAdjacentHTML('afterbegin', `<section class="panel s12" id="announcements"><header><div><span class="eyebrow">From the commissioner</span><h2>Announcements</h2></div></header>
      <div class="ann-list">${list.map(a => `<article class="ann"><b>${esc(a.title)}</b><p>${esc(a.body)}</p>
        <span class="pmeta">${UI.annTime(a.at)}</span></article>`).join('')}</div></section>`);
    if (location.hash === '#announcements') document.getElementById('announcements').scrollIntoView();
  }

  async function start() {
    try {
      M = await Hub.load();
      // Live NFL data, if it comes, redraws just the Blitz Network panel.
      const relive = L => { const el = document.querySelector('.network'); if (!el) return; el.outerHTML = network(news, L); paintHelmets(document).catch(() => {}); };
      const [news, N] = await Promise.all([fetch('data/news.json').then(r => (r.ok ? r.json() : { stories: [] })).catch(() => ({ stories: [] })),
        window.NFL ? NFL.load(M, L => relive(L)).catch(e => (console.error(e), null)) : null]);
      document.getElementById('sample-flag').hidden = M.live;
      UI.myTeam(M);
      document.getElementById('season').innerHTML = `<strong>${esc(M.state.season)} season</strong><span>Week ${M.current}</span>`;
      document.getElementById('crumb').innerHTML = `<strong>Home</strong>`;
      document.getElementById('hero').innerHTML = hero();
      const games = gamesFor(M.current);
      document.getElementById('content').innerHTML = `<div class="grid">
        <section class="panel s12"><header><div><span class="eyebrow">Week ${M.current}</span><h2>This week</h2></div><a class="aside" href="matchup.html">All matchups</a></header>
          ${showcase(games)}${scoreboard(games)}</section>
        ${network(news, N)}
        <div class="s8 stack">
          <section class="panel"><header><div><span class="eyebrow">Week ${M.current - 1}</span><h2>Last week's awards</h2></div></header>${awards()}</section>
          <section class="panel"><header><div><span class="eyebrow">Wire and trades</span><h2>Latest moves</h2></div></header>${moves()}</section>
        </div>
        <section class="panel s4"><header><div><span class="eyebrow">Standings</span><h2>Division races</h2></div><a class="aside" href="standings.html">Full standings</a></header>${snapshot()}</section>
        <section class="panel s12"><header><div><span class="eyebrow">${Object.keys(M.teams).length} franchises</span><h2>The league</h2></div></header>${directory()}</section>
      </div>`;
      rotate(document.querySelector('.show'));
      paintHelmets(document).catch(e => console.error(e));
      announcements();
    } catch (e) {
      document.getElementById('content').innerHTML = `<div class="error">Couldn't load league data. ${esc(e.message)}</div>`;
      console.error(e);
    }
  }
  start();
})();
