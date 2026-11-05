/* League home: this week's games (with broadcast and line), the Blitz Network (data/news.json stories plus an automatic
   wire written from league results), last week's awards, standings snapshot, latest moves, franchise directory. */
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
    return `<section class="lhero home">${lg.logo ? `<img class="hero-watermark" src="${esc(lg.logo)}" alt="" aria-hidden="true">` : ''}<div class="wrap">
      ${lg.logo ? `<img class="lhero-logo big" src="${esc(lg.logo)}" alt="${esc(lg.name)}">` : ''}
      <div><span class="eyebrow">${esc(M.state.season)} season · Week ${M.current}</span><h1>${esc(lg.name)}</h1>
      <div class="nick">${Object.keys(M.teams).length} franchises · ${lg.divisions.length} divisions · Dynasty on Sleeper</div></div>
      <div class="lhero-divs">${lg.divisions.map(d => `<div>${divMarkHTML(d, 'divmark divmark-lg')}<span>${esc(d.name)}</span></div>`).join('')}</div>
    </div></section>`;
  }

  // Game of the week: the matchup with the most combined wins (ties: most combined points for).
  function featured(games) {
    const g = games.slice().sort((a, b) => ((b.me && b.opp ? M.teams[b.me.roster_id].wins + b.opp.wins : 0) - (M.teams[a.me.roster_id].wins + a.opp.wins))
      || (M.teams[b.me.roster_id].pf + b.opp.pf - M.teams[a.me.roster_id].pf - a.opp.pf))[0];
    const L = M.teams[g.me.roster_id], R = g.opp, st = state(g);
    const sc = (v) => (st === 'upcoming' ? '' : f2(v));
    return `<a class="gotw" href="${mlink(g.week, L.id)}" style="--lw:${wash(L.f)};--rw:${wash(R.f)};--lc:${accentFor(L.f)};--rc:${accentFor(R.f)}">
      <span class="eyebrow">Game of the week · most combined wins</span>
      <div class="gotw-row">
        ${helmetHTML(L.f, { facing: 'right', variant: 'home' })}
        <div class="gside"><b>${esc(L.f.location)}</b><small>${rec(L)}</small><span class="gs">${sc(g.me.points)}</span></div>
        <div class="gmid">${UI.billingHTML(M, g)}<span class="mstatus ${st}">${st === 'final' ? 'Final' : st === 'live' ? 'Live' : 'Upcoming'}${st === 'live' ? '<i></i>' : ''}</span><em>vs</em>
          ${UI.broadcastHTML(M)}</div>
        <div class="gside r"><b>${esc(R.f.location)}</b><small>${rec(R)}</small><span class="gs">${sc(g.oppRow.points)}</span></div>
        ${helmetHTML(R.f, { facing: 'left', variant: 'away' })}
      </div>
      ${UI.oddsHTML(M, g)}
      <span class="gotw-cta">Open matchup</span>
    </a>`;
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

  function network(news) {
    const stories = (news.stories || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map(s => ({ tag: s.tag || 'News', head: esc(s.headline), dek: esc(s.dek || ''), href: s.url || '', image: s.image, byline: s.byline, date: s.date, breaking: s.breaking, t: (s.teams || []).map(r => M.teams[r]).find(Boolean) }));
    const all = [...stories, ...wire()];
    if (!all.length) return '';
    const breaking = stories.filter(s => s.breaking);
    const [lead, ...rest] = all;
    const art = s => (s.image ? `<img class="net-img" src="${esc(s.image)}" alt="">` : s.t ? primaryLogo(s.t.f, 'net-logo') : `<img class="net-logo" src="${esc((M.league.network || {}).mark || M.league.logo)}" alt="">`);
    const meta = s => [s.byline ? esc(s.byline) : s.date ? '' : 'Blitz Network Wire', s.date ? esc(s.date) : ''].filter(Boolean).join(' · ');
    const tag = s => `<span class="net-tag${s.breaking || /breaking/i.test(s.tag) ? ' hot' : ''}">${esc(s.tag)}</span>`;
    const a = (s, cls, inner) => (s.href ? `<a class="${cls}" href="${esc(s.href)}">${inner}</a>` : `<div class="${cls}">${inner}</div>`);
    return `<section class="panel s12 network">
      ${breaking.length ? `<div class="ticker"><b>Breaking</b><span>${breaking.map(s => s.head).join(' <i>/</i> ')}</span></div>` : ''}
      <header><div><span class="eyebrow">News, recaps and the wire</span><h2>${UI.netWord(M)}</h2></div><span class="aside">${stories.length ? `${stories.length} stor${stories.length === 1 ? 'y' : 'ies'}` : 'Wire only'}</span></header>
      <div class="net-grid">
        ${a(lead, 'net-lead', `<div class="net-art" style="${lead.t ? `--lw:${wash(lead.t.f)}` : ''}">${art(lead)}</div><div class="net-copy">${tag(lead)}<h3>${lead.head}</h3><p>${lead.dek}</p><span class="pmeta">${meta(lead)}</span></div>`)}
        <div class="net-list">${rest.slice(0, 5).map(s => a(s, 'net-item', `${s.t ? markSVG(s.t.f, 'mini') : (M.league.network || {}).mark ? `<img class="mini net-mark" src="${esc(M.league.network.mark)}" alt="">` : ''}<div>${tag(s)}<b>${s.head}</b><span class="pmeta">${s.dek}</span></div>`)).join('')}</div>
      </div>
      <p class="footnote">Wire stories are written automatically from league results. Blitz Network stories and breaking news go in data/news.json.</p>
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

  async function start() {
    try {
      M = await Hub.load();
      const news = await fetch('data/news.json').then(r => (r.ok ? r.json() : { stories: [] })).catch(() => ({ stories: [] }));
      document.getElementById('sample-flag').hidden = M.live;
      document.getElementById('season').innerHTML = `<strong>${esc(M.state.season)} season</strong><span>Week ${M.current}</span>`;
      document.getElementById('crumb').innerHTML = `<strong>Home</strong>`;
      document.getElementById('hero').innerHTML = hero();
      const games = gamesFor(M.current);
      document.getElementById('content').innerHTML = `<div class="grid">
        <section class="panel s12"><header><div><span class="eyebrow">Week ${M.current}</span><h2>This week</h2></div><a class="aside" href="matchup.html">All matchups</a></header>
          ${featured(games)}${scoreboard(games)}</section>
        ${network(news)}
        <div class="s8 stack">
          <section class="panel"><header><div><span class="eyebrow">Week ${M.current - 1}</span><h2>Last week's awards</h2></div></header>${awards()}</section>
          <section class="panel"><header><div><span class="eyebrow">Wire and trades</span><h2>Latest moves</h2></div></header>${moves()}</section>
        </div>
        <section class="panel s4"><header><div><span class="eyebrow">Standings</span><h2>Division races</h2></div><a class="aside" href="standings.html">Full standings</a></header>${snapshot()}</section>
        <section class="panel s12"><header><div><span class="eyebrow">${Object.keys(M.teams).length} franchises</span><h2>The league</h2></div></header>${directory()}</section>
      </div>`;
      paintHelmets(document).catch(e => console.error(e));
    } catch (e) {
      document.getElementById('content').innerHTML = `<div class="error">Couldn't load league data. ${esc(e.message)}</div>`;
      console.error(e);
    }
  }
  start();
})();
