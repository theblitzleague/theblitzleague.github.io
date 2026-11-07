/* Almanac: league records and history, computed only from games that have finished.
   Tabs: #records (default), #weekly, #champions. Grows automatically as seasons complete. */
(function () {
  const { esc, f1, f2, rec, leagueHero, tabsHTML, boot, allGames } = UI;
  let M, games;
  const P = id => M.players[id] || { full_name: `Player ${id}`, position: '?' };
  const T = rid => M.teams[rid];
  const mlink = (w, id) => `matchup.html#w${w}-t${id}`;
  const sides = g => [{ t: T(g.me.roster_id), p: g.me.points, o: g.opp, op: g.oppRow.points, row: g.me },
                      { t: g.opp, p: g.oppRow.points, o: T(g.me.roster_id), op: g.me.points, row: g.oppRow }];

  function streaks() {
    const best = { W: null, L: null };
    for (const t of Object.values(M.teams)) {
      let cur = null, n = 0, start = 0;
      for (const g of t.games.filter(g => g.final)) {
        if (g.result === cur) n++; else { cur = g.result; n = 1; start = g.week; }
        if (best[cur] === undefined) continue;
        if (!best[cur] || n > best[cur].n) best[cur] = { t, n, from: start, to: g.week };
      }
    }
    return best;
  }

  function records() {
    if (!games.length) return '<div class="empty">Records start once the first week is final.</div>';
    const all = games.flatMap(sides);
    const pick = (arr, f) => arr.reduce((a, b) => (f(b) > f(a) ? b : a));
    const hi = pick(all, s => s.p), lo = pick(all, s => -s.p);
    const wins = all.filter(s => s.p > s.op), losses = all.filter(s => s.p < s.op);
    const blow = pick(wins, s => s.p - s.op), close = pick(wins, s => -(s.p - s.op));
    const hiLoss = losses.length ? pick(losses, s => s.p) : null, loWin = pick(wins, s => -s.p);
    let topP = null;
    for (const g of games) for (const s of sides(g)) (s.row.starters || []).forEach((id, i) => {
      const v = (s.row.starters_points || [])[i];
      if (v != null && (!topP || v > topP.v)) topP = { id, v, t: s.t, w: g.week };
    });
    const weekOf = s => games.find(g => g.me === s.row || g.oppRow === s.row).week;
    const card = (lbl, big, who, sub, href, f) => `<a class="award rec" href="${href}">${f ? markSVG(f, 'mini') : ''}<div><span class="lbl">${lbl}</span><span class="big">${big}</span><span class="who">${who}</span>${sub ? `<span class="pmeta">${sub}</span>` : ''}</div></a>`;
    const sg = (lbl, s, val, who) => card(lbl, val, who || esc(s.t.f.location), `Week ${weekOf(s)} vs ${esc(s.o.f.location)} · ${f2(s.p)}-${f2(s.op)}`, mlink(weekOf(s), s.t.id), s.t.f);
    const st = streaks();
    const teams = Object.values(M.teams);
    const pf = teams.reduce((a, b) => (b.pf > a.pf ? b : a)), pa = teams.reduce((a, b) => (b.pa > a.pa ? b : a));
    const wk = games.length ? Math.max(...games.map(g => g.week)) : 0;
    return `<div class="grid">
      <section class="panel s12"><header><div><span class="eyebrow">Single game</span><h2>Game records</h2></div><span class="aside">${esc(M.state.season)}, weeks 1-${wk}</span></header>
        <div class="awards recs">
          ${sg('Highest score', hi, f2(hi.p))}
          ${sg('Lowest score', lo, f2(lo.p))}
          ${sg('Biggest blowout', blow, f2(blow.p - blow.op), `${esc(blow.t.f.location)} over ${esc(blow.o.f.location)}`)}
          ${sg('Narrowest win', close, f2(close.p - close.op), `${esc(close.t.f.location)} over ${esc(close.o.f.location)}`)}
          ${hiLoss ? sg('Most points in a loss', hiLoss, f2(hiLoss.p)) : ''}
          ${sg('Fewest points in a win', loWin, f2(loWin.p))}
          ${topP ? card('Top player game', f2(topP.v), esc(P(topP.id).full_name), `${esc(P(topP.id).position)} · ${esc(topP.t.f.location)} · Week ${topP.w}`, mlink(topP.w, topP.t.id), topP.t.f) : ''}
        </div></section>
      <section class="panel s12"><header><div><span class="eyebrow">Season</span><h2>Season records</h2></div><span class="aside">${esc(M.state.season)} so far</span></header>
        <div class="awards recs">
          ${card('Most points for', f1(pf.pf), esc(pf.f.location), rec(pf), `team.html?team=${pf.id}`, pf.f)}
          ${card('Most points against', f1(pa.pa), esc(pa.f.location), rec(pa), `team.html?team=${pa.id}`, pa.f)}
          ${st.W ? card('Longest win streak', st.W.n, esc(st.W.t.f.location), `Weeks ${st.W.from}-${st.W.to}`, `team.html?team=${st.W.t.id}#schedule`, st.W.t.f) : ''}
          ${st.L ? card('Longest losing streak', st.L.n, esc(st.L.t.f.location), `Weeks ${st.L.from}-${st.L.to}`, `team.html?team=${st.L.t.id}#schedule`, st.L.t.f) : ''}
        </div></section>
      <p class="footnote s12">The Almanac only counts finished games. All-time records start with the ${M.league.founded} inaugural season and carry forward as seasons are completed.</p>
    </div>`;
  }

  function weekly() {
    const weeks = [...new Set(games.map(g => g.week))];
    if (!weeks.length) return '<div class="empty">Nothing final yet.</div>';
    return `<section class="panel"><header><div><span class="eyebrow">${esc(M.state.season)}</span><h2>Week by week</h2></div></header>
    <div class="tablewrap"><table class="st wide"><thead><tr><th>Week</th><th>High score</th><th class="num">Pts</th><th class="hide-sm">Low score</th><th class="num hide-sm">Pts</th><th>Closest game</th><th class="num">Margin</th><th class="num hide-sm">League avg</th></tr></thead>
    <tbody>${weeks.map(w => {
      const gs = games.filter(g => g.week === w), all = gs.flatMap(sides);
      const hi = all.reduce((a, b) => (b.p > a.p ? b : a)), lo = all.reduce((a, b) => (b.p < a.p ? b : a));
      const m = g => Math.abs(g.me.points - g.oppRow.points), c = gs.reduce((a, b) => (m(b) < m(a) ? b : a));
      const cw = c.me.points >= c.oppRow.points ? T(c.me.roster_id) : c.opp, cl = cw === c.opp ? T(c.me.roster_id) : c.opp;
      const avg = all.reduce((n, s) => n + s.p, 0) / all.length;
      return `<tr><td class="rank">W${w}</td><td><a class="stteam" href="${mlink(w, hi.t.id)}">${markSVG(hi.t.f, 'mini')}<span><b>${esc(hi.t.f.location)}</b></span></a></td><td class="num strong">${f2(hi.p)}</td>
        <td class="hide-sm"><a class="stteam" href="${mlink(w, lo.t.id)}">${markSVG(lo.t.f, 'mini')}<span><b>${esc(lo.t.f.location)}</b></span></a></td><td class="num hide-sm">${f2(lo.p)}</td>
        <td><a href="${mlink(w, cw.id)}" class="closest">${esc(cw.f.abbr)} over ${esc(cl.f.abbr)}</a></td><td class="num">${f2(m(c))}</td><td class="num hide-sm">${f1(avg)}</td></tr>`;
    }).join('')}</tbody></table></div></section>`;
  }

  function champions() {
    const name = rid => (M.teams[rid] ? M.teams[rid].f.location : `Team ${rid}`);
    const done = Object.fromEntries(M.history.map(s => [s.season, s]));
    const seasons = [...M.history.map(s => ({ season: s.season, status: 'Final', s })),
      ...(done[M.state.season] ? [] : [{ season: M.state.season, status: 'In progress' }])];
    // The trophy's base has name plates; the case shows one per season, the current one first.
    const last = Math.max(+M.state.season, ...M.history.map(s => +s.season));
    const plates = Array.from({ length: Math.max(5, last - M.league.founded + 2) }, (_, i) => String(+M.league.founded + i));
    return `<div class="grid"><section class="panel s12 trophy-case">
      <img class="trophy" src="${esc(M.league.trophy)}" alt="The Blitz League championship trophy: an armored gauntlet holding a gold football, on a black marble base">
      <div class="tc-text"><span class="eyebrow">The prize</span><h2>Blitz League Champion</h2>
        <p>The top ${M.playoffTeams} teams make the playoffs, which start in week ${M.league.regularSeasonWeeks + 1}. Every champion's name goes on the base.${UI.prizes(M).champion ? ` The champion also takes ${UI.cash(UI.prizes(M).champion)}${UI.prizes(M).runnerUp ? ` and the runner-up ${UI.cash(UI.prizes(M).runnerUp)}` : ''}.` : ''}</p>
        <div class="plates">${plates.map(s => `<div class="plate${s === M.state.season ? ' now' : ''}"><b>${esc(s)}</b><span>${done[s] && done[s].champion ? esc(name(done[s].champion)) : s === M.state.season ? 'To be decided' : '&nbsp;'}</span></div>`).join('')}</div>
        ${M.history.some(s => s.champion) ? '' : `<div class="empty">No champion yet. The first Blitz League title is decided in the ${esc(M.state.season)} playoffs.</div>`}
      </div></section>
      ${[['opoy', 'Offensive Player of the Year', 'QB, RB, WR and TE: most points scored as a starter'], ['dpoy', 'Defensive Player of the Year', 'DL, LB and DB: most points scored as a starter'],
        ['roy', 'Rookie of the Year', 'First-year players at any position: most points scored as a starter']]
        .filter(([k]) => (M.league.awardTrophies || {})[k]).map(([k, name, how], i, all) => `<a class="panel ${all.length > 2 ? 's4' : 's6'} award-case" href="awards.html#players">
        <img src="${esc(M.league.awardTrophies[k])}" alt="The Blitz League ${esc(name)} trophy">
        <div><span class="eyebrow">Player award</span><h2>${esc(name)}</h2><p class="pmeta">${esc(how)}. Named after the regular season. ${M.state.season} race: see the Awards page.</p></div></a>`).join('')}
      <section class="panel s12"><header><div><span class="eyebrow">Since ${M.league.founded}</span><h2>Seasons</h2></div></header>
      <div class="tablewrap"><table class="st"><thead><tr><th>Season</th><th>Status</th><th>Champion</th><th>Runner-up</th><th class="hide-sm">Best record</th></tr></thead>
      <tbody>${seasons.map(({ season, status, s }) => {
        if (s) { const [bid, b] = Object.entries(s.teams || {}).sort((x, y) => (y[1].wins - x[1].wins) || (y[1].pf - x[1].pf))[0] || [];
          return `<tr><td class="strong">${esc(season)}</td><td><span class="tag ok">${status}</span></td><td>${s.champion ? esc(name(s.champion)) : '-'}${s.champion && s.teams[s.champion] ? ` <small>${esc(s.teams[s.champion].gmName || '')}</small>` : ''}</td><td>${s.runnerUp ? esc(name(s.runnerUp)) : '-'}</td><td class="hide-sm">${b ? `${esc(name(bid))} (${b.wins}-${b.losses})` : '-'}</td></tr>`; }
        const best = Object.values(M.teams).sort((a, b) => (b.wins - a.wins) || (b.pf - a.pf))[0];
        return `<tr><td class="strong">${esc(season)}</td><td><span class="tag taxi">${status}</span></td><td>-</td><td>-</td><td class="hide-sm">${esc(best.f.location)} (${rec(best)}, so far)</td></tr>`; }).join('')}</tbody></table></div></section></div>`;
  }

  function route() {
    const tab = ['records', 'weekly', 'champions'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'records';
    document.getElementById('tabs').innerHTML = tabsHTML([['records', 'Records'], ['weekly', 'Week by week'], ['champions', 'Champions']], tab);
    document.getElementById('content').innerHTML = { records, weekly, champions }[tab]();
  }

  boot('League · <strong>Almanac</strong>', m => {
    M = m;
    games = allGames(M, g => g.final);
    document.getElementById('hero').innerHTML = leagueHero(M, `${M.league.name} · Est. ${M.league.founded}`, 'Almanac', `Records and history · ${games.length} games played`);
    route();
    addEventListener('hashchange', route);
  });
})();
