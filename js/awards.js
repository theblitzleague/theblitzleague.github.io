/* Awards race: season-long races computed from finished games only.
   Tabs: #points (default), #playoffs, #gm, #players, #prizes.
   - Prize money comes from league.json "prizes"; each award shows its amount beside it (UI.cash).
   - Lineup IQ = points actually started / points of the best legal lineup from that week's roster (Sleeper players_points).
   - Playoff odds = 10,000 seeded simulations of the remaining schedule from each team's real weekly scores.
   - Player awards split offense (QB/RB/WR/TE) and defense (DL/LB/DB and their exact-spot variants) so the scoring scales never mix.
   - GM Index = weighted blend (league.json gmIndexWeights) of win %, Lineup IQ and value from moves, each scaled 0-100 across the league.
     GM of the Year itself is a league vote at season's end; the index is the evidence for it. */
(function () {
  const { esc, f1, f2, rec, shot, leagueHero, tabsHTML, boot } = UI;
  let M, finals, through;
  const P = id => M.players[id] || null;
  const pname = id => (P(id) ? P(id).full_name : `Player ${id}`);
  const ppos = id => (P(id) ? P(id).position : '?');
  // Sleeper's own slot eligibility list (e.g. an OLB can be ['LB','DL']); falls back to the listed position.
  const fpos = id => (P(id) && P(id).fantasy_positions && P(id).fantasy_positions.length ? P(id).fantasy_positions : [ppos(id)]);
  const tlink = (t, hash) => `team.html?team=${t.id}${hash || ''}`;
  const teamCell = t => `<a class="stteam" href="${tlink(t)}">${markSVG(t.f, 'mini')}<span><b>${esc(t.f.location)}</b>${t.f.nickname ? ` <small>${esc(t.f.nickname)}</small>` : ''}</span></a>`;
  // A GM: their portrait (franchises.json gm.portrait, else their Sleeper avatar once the league is live, else a
  // silhouette), their name, and the team they run underneath. Links to that team's Front Office.
  const gmCell = t => {
    const g = t.f.gm || {}, av = t.owner && t.owner.avatar ? `https://sleepercdn.com/avatars/thumbs/${encodeURIComponent(t.owner.avatar)}` : null;
    const name = g.name || (t.owner && t.owner.display_name) || null;
    return `<a class="gmcell" href="${tlink(t, '#front-office')}"><img class="shot gmshot" src="${esc(g.portrait || av || UI.SIL)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${UI.SIL}'">
      <span><b>${name ? esc(name) : 'Open seat'}</b><small>${markSVG(t.f, 'mini')} ${esc(t.f.location)}${t.f.nickname ? ' ' + esc(t.f.nickname) : ''}</small></span></a>`;
  };
  const playerCell = id => `<div class="cellp"${UI.pid(id)}>${shot(id)}<div><div class="pname">${esc(pname(id))} <span class="pos ${esc(ppos(id))}">${esc(ppos(id))}</span></div></div></div>`;
  const order = (a, b) => (b.wins - a.wins) || (b.pf - a.pf);
  const card = (lbl, big, who, sub, href, f, prize) => `<a class="award" href="${href}">${f ? markSVG(f, 'mini') : ''}<div><span class="lbl">${lbl}${prize || ''}</span><span class="big">${big}</span><span class="who">${who}</span>${sub ? `<span class="pmeta">${sub}</span>` : ''}</div></a>`;
  const pct = x => `${Math.round(x * 100)}%`;
  const Z = () => UI.prizes(M);
  const trophy = k => { const src = (M.league.awardTrophies || {})[k]; return src ? `<img class="hdr-trophy" src="${esc(src)}" alt="">` : ''; };
  const honor = name => ((Z().honorsOnly || []).includes(name) ? UI.honorOnly() : '');
  const perWeek = () => (Z().weekly ? `<span class="cash">${UI.money(Z().weekly)} a week</span>` : '');

  // ---------- Shared numbers ----------
  // Every started player score in a finished game: who started him, which week, how many points.
  function starts() {
    const out = [];
    for (const t of Object.values(M.teams)) for (const g of t.games.filter(g => g.final)) {
      (g.me.starters || []).forEach((id, i) => {
        if (!id || id === '0') return;
        out.push({ rid: t.id, week: g.week, id, v: (g.me.starters_points || [])[i] || 0 });
      });
    }
    return out;
  }

  // Best legal lineup from a week's roster. Most restrictive slots fill first (QB, RB, ... then flex, then superflex).
  // Sleeper lists defenders either by group (DL/LB/DB) or by exact spot (DE, CB, ...), so slots accept both.
  const DL = ['DL', 'DE', 'DT'], LB = ['LB', 'ILB', 'OLB'], DB = ['DB', 'CB', 'S', 'SS', 'FS'];
  const ELIG = { FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['WR', 'RB'], REC_FLEX: ['WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
    DL, LB, DB, IDP_FLEX: [...DL, ...LB, ...DB] };
  const OFFENSE = ['QB', 'RB', 'WR', 'TE'], DEFENSE = [...DL, ...LB, ...DB];
  const elig = s => ELIG[s] || [s];
  function optimal(row) {
    const pp = row.players_points;
    if (!pp) return null;
    const pool = Object.keys(pp).filter(P).map(k => ({ k, pos: [ppos(k), ...fpos(k)], v: pp[k] || 0 })).sort((a, b) => b.v - a.v);
    const used = new Set();
    let total = 0;
    for (const s of M.slots.slice().sort((a, b) => elig(a).length - elig(b).length)) {
      const c = pool.find(p => !used.has(p.k) && p.pos.some(x => elig(s).includes(x)));
      if (c) { used.add(c.k); total += c.v; }
    }
    return total;
  }

  function lineupIQ() {
    const out = {};
    for (const t of Object.values(M.teams)) {
      let act = 0, best = 0, worst = null;
      for (const g of t.games.filter(g => g.final)) {
        const o = optimal(g.me);
        if (o == null) continue;
        act += g.me.points; best += o;
        const left = o - g.me.points;
        if (!worst || left > worst.left) worst = { left, week: g.week };
      }
      out[t.id] = best ? { act, best, iq: act / best, left: best - act, worst } : null;
    }
    return out;
  }

  // Points a team got from its moves: starting points from players it added (trade, waiver or free agent) since the move,
  // minus starting points that players it traded away gave their new team. Draft picks count once they become players.
  function moves(S) {
    const val = id => Object.fromEntries(Object.keys(M.teams).map(r => [r, 0]));
    const net = val(), detail = [];
    const since = (id, rid, wk) => S.filter(s => s.id === id && s.rid === rid && s.week >= wk).reduce((n, s) => n + s.v, 0);
    for (const x of M.transactions) {
      if (x.status && x.status !== 'complete') continue;
      const wk = x.leg || 1;
      for (const [id, rid] of Object.entries(x.adds || {})) {
        const v = since(id, rid, wk);
        net[rid] += v;
        if (x.type === 'trade') {
          const from = (x.drops || {})[id];
          if (from != null && net[from] != null) net[from] -= v;
        }
        detail.push({ x, id, rid, v, from: x.type === 'trade' ? (x.drops || {})[id] : null });
      }
    }
    return { net, detail };
  }

  // ---------- Points race ----------
  function points() {
    if (!finals.length) return '<div class="empty">The points race starts once week 1 is final.</div>';
    const teams = Object.values(M.teams).sort((a, b) => b.pf - a.pf), lead = teams[0], max = lead.pf;
    const iq = lineupIQ();
    const form = t => { const d = t.games.filter(g => g.final).slice(-3); return d.reduce((n, g) => n + g.me.points, 0) / (d.length || 1); };
    const best = Object.values(M.teams).flatMap(t => t.games.filter(g => g.final).map(g => ({ t, g }))).reduce((a, b) => (b.g.me.points > a.g.me.points ? b : a));
    const hot = Object.values(M.teams).reduce((a, b) => (form(b) > form(a) ? b : a));
    const iqTeams = Object.values(M.teams).filter(t => iq[t.id]);
    const iqSorted = iqTeams.slice().sort((a, b) => iq[b.id].iq - iq[a.id].iq);
    const bench = iqTeams.slice().sort((a, b) => iq[b.id].left - iq[a.id].left);
    const worstWeek = iqTeams.map(t => ({ t, ...iq[t.id].worst })).reduce((a, b) => (b.left > a.left ? b : a), { left: -1 });
    const gp = t => t.games.filter(g => g.final).length;
    // Most weekly high scores so far (ties listed together).
    const ww = UI.weeklyWinners(M), tally = {};
    ww.forEach(w => w.winners.forEach(t => { const x = tally[t.id] || (tally[t.id] = { t, n: 0, v: 0 }); x.n++; x.v += w.each; }));
    const tl = Object.values(tally).sort((a, b) => (b.n - a.n) || (b.v - a.v)), topN = tl.length ? tl[0].n : 0, tops = tl.filter(x => x.n === topN);
    const wkTop = { n: topN, v: tops.length ? tops[0].v : 0, names: tops.map(x => esc(x.t.f.location)).join(', '), f: tops.length === 1 ? tops[0].t.f : null };
    return `<div class="grid">
      <section class="panel s12"><header><div><span class="eyebrow">Leaders</span><h2>Points race</h2></div><span class="aside">Through week ${through}</span></header>
        <div class="awards recs">
          ${card('Points leader', f1(lead.pf), esc(lead.f.location), `${f1(lead.pf - teams[1].pf)} ahead of ${esc(teams[1].f.location)}`, tlink(lead), lead.f, UI.cash(Z().pointsLeader))}
          ${card('Best single week', f2(best.g.me.points), esc(best.t.f.location), `Week ${best.g.week} vs ${esc(best.g.opp.f.location)}`, `matchup.html#w${best.g.week}-t${best.t.id}`, best.t.f)}
          ${ww.length ? card('Weekly high scores', String(wkTop.n), wkTop.names, `${UI.money(wkTop.v)} won so far`, 'awards.html#prizes', wkTop.f, perWeek()) : ''}
          ${card('Hottest offense', f1(form(hot)), esc(hot.f.location), 'Average, last 3 weeks', tlink(hot, '#schedule'), hot.f)}
          ${iqSorted.length ? card('Lineup IQ leader', pct(iq[iqSorted[0].id].iq), esc(iqSorted[0].f.location), `${f1(iq[iqSorted[0].id].left)} points left on the bench`, tlink(iqSorted[0], '#depth-chart'), iqSorted[0].f) : ''}
          ${bench.length ? card('Bench Warmer', f1(iq[bench[0].id].left), esc(bench[0].f.location), 'Most points left on the bench', tlink(bench[0], '#depth-chart'), bench[0].f) : ''}
        </div></section>
      <section class="panel s12"><header><div><span class="eyebrow">Points for</span><h2>Scoring leaders</h2></div></header>
        <div class="tablewrap"><table class="st wide"><thead><tr><th class="num">#</th><th>Team</th><th class="num">PF</th><th class="pfbar hide-sm"></th><th class="num">Back</th><th class="num">PPG</th><th class="num hide-sm">Last 3</th><th class="num hide-sm">Best</th><th class="num hide-sm">Worst</th></tr></thead>
        <tbody>${teams.map((t, i) => `<tr><td class="num rank">${i + 1}</td><td>${teamCell(t)}</td><td class="num strong">${f1(t.pf)}</td>
          <td class="pfbar hide-sm"><i style="width:${(t.pf / max * 100).toFixed(1)}%"></i></td><td class="num">${i ? '-' + f1(max - t.pf) : '-'}</td>
          <td class="num">${f1(t.pf / (gp(t) || 1))}</td><td class="num hide-sm">${f1(form(t))}</td><td class="num hide-sm">${f2(t.high)}</td><td class="num hide-sm">${f2(t.low)}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="panel s12"><header><div><span class="eyebrow">Started vs. best possible lineup</span><h2>Lineup IQ</h2></div></header>
        ${iqSorted.length ? `<div class="tablewrap"><table class="st"><thead><tr><th class="num">#</th><th>Team</th><th class="num">IQ</th><th class="num">Started</th><th class="num hide-sm">Best possible</th><th class="num">On bench</th></tr></thead>
        <tbody>${iqSorted.map((t, i) => { const q = iq[t.id];
          return `<tr><td class="num rank">${i + 1}</td><td>${teamCell(t)}</td><td class="num strong">${(q.iq * 100).toFixed(1)}%</td><td class="num">${f1(q.act)}</td><td class="num hide-sm">${f1(q.best)}</td><td class="num down">${f1(q.left)}</td></tr>`; }).join('')}</tbody></table></div>`
          : '<div class="empty">Lineup IQ needs bench scores, which arrive with each week\'s results.</div>'}
        <div class="legend"><p><b>Lineup IQ</b> is points actually started, divided by the best legal lineup that roster could have started that week, in hindsight.
          100% means a perfect lineup every week. <b>On bench</b> is the gap: points that sat. The most points left on the bench wins the Bench Warmer.${worstWeek.t ? ` Worst single week so far: <b>${esc(worstWeek.t.f.location)}</b>, ${f1(worstWeek.left)} points left on the bench in week ${worstWeek.week}.` : ''}</p></div></section>
    </div>`;
  }

  // ---------- Playoff race ----------
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function simulate(N) {
    const teams = Object.values(M.teams), PT = M.playoffTeams;
    const rem = UI.allGames(M, g => !g.final).map(g => [g.me.roster_id, g.opp.id]);
    // Score model: each team's real average, pulled toward the league average early in the year (k = 3 games), with the
    // league's typical week-to-week spread.
    const all = teams.flatMap(t => t.games.filter(g => g.final).map(g => g.me.points));
    const lg = all.reduce((a, b) => a + b, 0) / all.length;
    const mean = {}, left = {};
    let ss = 0;
    for (const t of teams) {
      const s = t.games.filter(g => g.final).map(g => g.me.points), m = s.reduce((a, b) => a + b, 0) / (s.length || 1);
      s.forEach(x => (ss += (x - m) ** 2));
      mean[t.id] = (s.length * m + 3 * lg) / (s.length + 3);
      left[t.id] = rem.filter(g => g.includes(t.id)).length;
    }
    const sd = Math.sqrt(ss / Math.max(1, all.length - teams.length));
    const R = rng(+M.state.season * 100 + M.current);
    const normal = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };
    const out = Object.fromEntries(teams.map(t => [t.id, { made: 0, top: 0, div: 0, wins: 0 }]));
    for (let n = 0; n < N; n++) {
      const w = {}, pf = {};
      for (const t of teams) { w[t.id] = t.wins + t.ties / 2; pf[t.id] = t.pf; }
      for (const [a, b] of rem) {
        const sa = mean[a] + sd * normal(), sb = mean[b] + sd * normal();
        w[sa >= sb ? a : b]++; pf[a] += sa; pf[b] += sb;
      }
      const ranked = teams.map(t => t.id).sort((x, y) => (w[y] - w[x]) || (pf[y] - pf[x]));
      ranked.forEach((id, i) => { if (i < PT) out[id].made++; out[id].wins += w[id]; });
      out[ranked[0]].top++;
      for (const d of M.league.divisions) out[ranked.find(id => M.teams[id].division === d)].div++;
    }
    for (const t of teams) {
      const o = out[t.id];
      o.made /= N; o.top /= N; o.div /= N; o.wins /= N;
      o.sos = left[t.id] ? rem.filter(g => g.includes(t.id)).reduce((n, g) => n + mean[g[0] === t.id ? g[1] : g[0]], 0) / left[t.id] : null;
    }
    // Clinched / eliminated, proven from records alone (ties assumed to go against the team, so these never overclaim).
    const wn = t => t.wins + t.ties / 2;
    for (const t of teams) {
      const others = teams.filter(o => o !== t);
      out[t.id].clinched = others.filter(o => wn(o) + left[o.id] >= wn(t)).length <= PT - 1;
      out[t.id].elim = others.filter(o => wn(o) > wn(t) + left[t.id]).length >= PT;
      out[t.id].left = left[t.id];
    }
    return { out, rem: rem.length, sd, lg };
  }

  function odds(x, o, key) {
    if (key === 'made' && o.clinched) return '<b class="odds full">100%</b>';
    if (key === 'made' && o.elim) return '<span class="odds none">0%</span>';
    if (x >= 0.995) return '<b class="odds full">&gt;99%</b>';
    if (x > 0 && x < 0.005) return '<span class="odds">&lt;1%</span>';
    if (x === 0) return '<span class="odds none">0%</span>';
    return `<span class="odds" style="--o:${(x * 100).toFixed(0)}%">${Math.round(x * 100)}%</span>`;
  }

  function playoffs() {
    if (!finals.length) return '<div class="empty">The playoff race starts once week 1 is final.</div>';
    const PT = M.playoffTeams, sim = simulate(10000), teams = Object.values(M.teams).sort(order);
    const line = teams[PT - 1], first = teams[PT];
    const gb = (a, b) => ((a.wins - b.wins) + (b.losses - a.losses)) / 2;
    const fmt = n => (n % 1 ? n.toFixed(1) : String(n));
    const status = o => (o.clinched ? '<span class="tag ok">Clinched</span>' : o.elim ? '<span class="tag out">Eliminated</span>' : '');
    const rows = teams.map((t, i) => {
      const o = sim.out[t.id], g = i < PT ? gb(t, first) : gb(line, t);
      const pos = i < PT ? (g > 0 ? `+${fmt(g)}` : 'Tied') : (g > 0 ? `-${fmt(g)}` : 'Tied');
      const pw = o.wins, pl = (t.wins + t.losses + t.ties + o.left) - pw;
      return `${i === PT ? `<tr class="cutline"><td colspan="10"><span>Playoff line · top ${PT} make it</span></td></tr>` : ''}
        <tr class="${i < PT ? 'in' : 'out'}"><td class="num rank">${i + 1}</td><td>${teamCell(t)} ${status(o)}</td><td class="num strong">${rec(t)}</td>
        <td class="num hide-sm">${f1(t.pf)}</td><td class="num ${i < PT ? 'up' : 'down'}">${pos}</td><td class="num hide-sm">${pw.toFixed(1)}-${pl.toFixed(1)}</td>
        <td class="num">${odds(o.made, o, 'made')}</td><td class="num hide-sm">${odds(o.top, o)}</td><td class="num hide-sm">${odds(o.div, o)}</td>
        <td class="num hide-sm">${o.sos == null ? '-' : f1(o.sos)}</td></tr>`;
    }).join('');
    const bubble = teams.filter(t => { const m = sim.out[t.id].made; return m > 0.1 && m < 0.9; });
    return `<div class="grid">
      <a class="panel s12 prize" href="almanac.html#champions"><img src="${esc(M.league.trophy)}" alt="">
        <div><span class="eyebrow">Playing for</span><h2>The Blitz League Championship</h2><span class="pmeta prizeline">${Z().champion ? `Champion ${UI.cash(Z().champion)}` : ''}${Z().runnerUp ? ` · Runner-up ${UI.cash(Z().runnerUp)}` : ''}${Z().champion ? ' · ' : ''}Playoffs start week ${M.league.regularSeasonWeeks + 1}. See the trophy case</span></div></a>
      <section class="panel s12"><header><div><span class="eyebrow">Top ${PT} make the playoffs · no byes</span><h2>Playoff race</h2></div>
        <span class="aside">${sim.rem ? `${sim.rem} games left` : 'Regular season complete'}</span></header>
        <div class="tablewrap"><table class="st wide race"><thead><tr><th class="num">Seed</th><th>Team</th><th class="num">W-L</th><th class="num hide-sm">PF</th><th class="num">vs line</th>
          <th class="num hide-sm">Proj.</th><th class="num">Playoffs</th><th class="num hide-sm">#1 seed</th><th class="num hide-sm">Win div.${Z().division ? ` <small>${UI.money(Z().division)}</small>` : ''}</th><th class="num hide-sm">Opp. avg</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <div class="legend"><p><b>vs line</b> is games ahead of the first team out (for teams in) or behind the last team in (for teams out). Ties are broken by points for.
          <b>Odds</b> come from 10,000 simulations of the ${sim.rem} remaining games. Each team scores around its real average this season
          (pulled toward the league average of ${f1(sim.lg)} while samples are small), give or take the league's typical ${f1(sim.sd)}-point week-to-week swing.
          The week in progress is simulated as if unplayed. <b>Proj.</b> is the average final record, and <b>Opp. avg</b> is what the remaining opponents are expected to score.
          <b>Clinched</b> and <b>Eliminated</b> are mathematically certain from records alone, not from the simulation.${Z().division ? ` Each division winner takes ${UI.money(Z().division)}, playoffs or not.` : ''}</p></div></section>
      ${bubble.length ? `<section class="panel s12"><header><div><span class="eyebrow">Between 10% and 90%</span><h2>On the bubble</h2></div></header>
        <div class="awards recs">${bubble.map(t => { const o = sim.out[t.id], next = t.games.find(g => !g.final);
          return card(`${teams.indexOf(t) < PT ? 'In' : 'Out'} as of now · ${o.left} left`, pct(o.made), esc(t.f.location), next ? `Next: week ${next.week} vs ${esc(next.opp.f.location)}` : '', next ? `matchup.html#w${next.week}-t${t.id}` : tlink(t), t.f); }).join('')}</div></section>` : ''}
      <p class="footnote s12">Seeding is by record alone, so division winners aren't guaranteed a spot. Playoff format: top ${PT}, set in league.json${M.live ? ' (Sleeper\'s league setting overrides it)' : ''}.</p>
    </div>`;
  }

  // ---------- GM Index ----------
  function gm() {
    if (!finals.length) return '<div class="empty">The GM Index starts once week 1 is final.</div>';
    const S = starts(), iq = lineupIQ(), mv = moves(S), teams = Object.values(M.teams);
    const W = M.league.gmIndexWeights || { winPct: 0.4, lineupIQ: 0.3, moves: 0.3 };
    const raw = {
      winPct: t => { const g = t.wins + t.losses + t.ties; return g ? (t.wins + t.ties / 2) / g : 0; },
      lineupIQ: t => (iq[t.id] ? iq[t.id].iq : null),
      moves: t => mv.net[t.id],
    };
    const scaled = {};
    for (const k of Object.keys(raw)) {
      const vals = teams.map(raw[k]).filter(v => v != null), lo = Math.min(...vals), hi = Math.max(...vals);
      scaled[k] = Object.fromEntries(teams.map(t => { const v = raw[k](t); return [t.id, v == null ? null : hi > lo ? (v - lo) / (hi - lo) * 100 : 50]; }));
    }
    const index = t => { let n = 0, d = 0; for (const k of Object.keys(raw)) if (scaled[k][t.id] != null && W[k]) { n += W[k] * scaled[k][t.id]; d += W[k]; } return d ? n / d : 0; };
    const rows = teams.map(t => ({ t, i: index(t) })).sort((a, b) => b.i - a.i);
    const sw = Object.values(W).reduce((a, b) => a + b, 0) || 1, wp = k => Math.round((W[k] || 0) / sw * 100);
    const comp = (k, t, txt) => `<td class="num">${txt}<small class="sc">${scaled[k][t.id] == null ? '' : Math.round(scaled[k][t.id])}</small></td>`;
    return `<div class="grid">
      <section class="panel s12"><header><div><span class="eyebrow">GM of the Year race ${UI.cash(Z().gmOfYear)}</span><h2>GM Index</h2></div><span class="aside">Through week ${through}</span></header>
        <div class="tablewrap"><table class="st wide"><thead><tr><th class="num">#</th><th>GM</th><th class="num">Index</th><th class="pfbar hide-sm"></th>
          <th class="num">Win % <small>${wp('winPct')}%</small></th><th class="num">Lineup IQ <small>${wp('lineupIQ')}%</small></th><th class="num">Moves <small>${wp('moves')}%</small></th></tr></thead>
        <tbody>${rows.map(({ t, i }, n) => `<tr><td class="num rank">${n + 1}</td><td>${gmCell(t)}</td>
          <td class="num strong">${i.toFixed(1)}</td><td class="pfbar hide-sm"><i style="width:${i.toFixed(1)}%"></i></td>
          ${comp('winPct', t, raw.winPct(t).toFixed(3).replace(/^0/, ''))}${comp('lineupIQ', t, iq[t.id] ? (iq[t.id].iq * 100).toFixed(1) + '%' : '-')}
          ${comp('moves', t, `${mv.net[t.id] > 0 ? '+' : ''}${f1(mv.net[t.id])}`)}</tr>`).join('')}</tbody></table></div>
        <div class="legend"><p>Each part is scaled from 0 (worst in the league) to 100 (best), shown small beside the raw number, then blended by weight: win % ${wp('winPct')}%, Lineup IQ ${wp('lineupIQ')}%, moves ${wp('moves')}%.
          <b>Moves</b> is starting points from players a team added by trade, waiver or free agency since the move, minus starting points that players it traded away have
          scored for their new team. Draft picks count once they become players. The weights live in league.json, so the commissioner can change them.</p>
          <p style="margin-top:8px"><b>GM of the Year is decided by a league vote at the end of the season.</b> The index is the evidence, not the verdict.</p></div></section>
    </div>`;
  }

  // ---------- Player awards ----------
  function players() {
    if (!finals.length) return '<div class="empty">Player awards start once week 1 is final.</div>';
    const S = starts(), mv = moves(S);
    const byPlayer = {};
    for (const s of S) { const p = byPlayer[s.id] || (byPlayer[s.id] = { id: s.id, v: 0, n: 0, last: s }); p.v += s.v; p.n++; if (s.week >= p.last.week) p.last = s; }
    const all = Object.values(byPlayer).sort((a, b) => b.v - a.v);
    const tableOf = (list, extra) => `<div class="tablewrap"><table class="st"><thead><tr><th class="num">#</th><th>Player</th><th class="hide-sm">Team</th><th class="num">Starts</th><th class="num">Pts</th><th class="num hide-sm">PPG</th>${extra ? `<th class="hide-sm">${extra[0]}</th>` : ''}</tr></thead>
      <tbody>${list.map((p, i) => { const t = M.teams[p.rid || p.last.rid];
        return `<tr><td class="num rank">${i + 1}</td><td>${playerCell(p.id)}</td><td class="hide-sm">${teamCell(t)}</td><td class="num">${p.n}</td><td class="num strong">${f1(p.v)}</td><td class="num hide-sm">${f1(p.v / (p.n || 1))}</td>${extra ? `<td class="hide-sm pmeta">${extra[1](p)}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>`;
    const isDef = id => [ppos(id), ...fpos(id)].some(x => DEFENSE.includes(x));
    const off = all.filter(p => !isDef(p.id) && [ppos(p.id), ...fpos(p.id)].some(x => OFFENSE.includes(x))).slice(0, 10), def = all.filter(p => isDef(p.id)).slice(0, 10);
    const rookies = all.filter(p => P(p.id) && P(p.id).years_exp === 0).slice(0, 5);
    const teamMvp = Object.values(M.teams).sort((a, b) => a.f.location.localeCompare(b.f.location)).map(t => {
      const mine = {};
      S.filter(s => s.rid === t.id).forEach(s => (mine[s.id] = (mine[s.id] || 0) + s.v));
      const top = Object.entries(mine).sort((a, b) => b[1] - a[1])[0];
      return top ? { t, id: top[0], v: top[1] } : null;
    }).filter(Boolean);
    const wire = mv.detail.filter(d => d.x.type !== 'trade').map(d => ({ id: d.id, rid: d.rid, v: d.v, n: S.filter(s => s.id === d.id && s.rid === d.rid && s.week >= (d.x.leg || 1)).length, x: d.x }))
      .filter(p => p.n > 0).sort((a, b) => b.v - a.v).slice(0, 5);
    const trades = M.transactions.filter(x => x.type === 'trade').map(x => {
      const sides = (x.roster_ids || []).map(rid => {
        const got = mv.detail.filter(d => d.x === x && d.rid === rid), gave = mv.detail.filter(d => d.x === x && d.from === rid);
        const picks = (x.draft_picks || []).filter(p => p.owner_id === rid);
        return { rid, got, picks, net: got.reduce((n, d) => n + d.v, 0) - gave.reduce((n, d) => n + d.v, 0) };
      });
      return { x, sides, best: Math.max(...sides.map(s => s.net)) };
    }).sort((a, b) => b.best - a.best);
    return `<div class="grid">
      <section class="panel s6"><header><div class="hwith">${trophy('opoy')}<div><span class="eyebrow">QB · RB · WR · TE ${honor('Offensive Player of the Year')}</span><h2>Offensive Player of the Year</h2></div></div><span class="aside">Through week ${through}</span></header>
        ${off.length ? tableOf(off) : '<div class="empty">No offensive player has started yet.</div>'}</section>
      <section class="panel s6"><header><div class="hwith">${trophy('dpoy')}<div><span class="eyebrow">DL · LB · DB ${honor('Defensive Player of the Year')}</span><h2>Defensive Player of the Year</h2></div></div><span class="aside">Through week ${through}</span></header>
        ${def.length ? tableOf(def) : `<div class="empty">${M.live ? 'No defensive player has started yet.' : 'The sample league has no defensive players. This race fills in once the real lineup, with its defensive slots, is set.'}</div>`}</section>
      <section class="panel s6"><header><div class="hwith">${trophy('roy')}<div><span class="eyebrow">First-year players ${honor('Rookie of the Year')}</span><h2>Rookie of the Year</h2></div></div><span class="aside">Through week ${through}</span></header>
        ${rookies.length ? tableOf(rookies) : '<div class="empty">No rookie has started a game yet.</div>'}</section>
      <section class="panel s6"><header><div><span class="eyebrow">Waivers and free agents ${honor('Pickup of the Year')}</span><h2>Pickup of the Year</h2></div></header>
        ${wire.length ? tableOf(wire, ['Added', p => `Week ${p.x.leg || '?'} · ${p.x.type === 'waiver' ? 'waivers' + (p.x.settings && p.x.settings.waiver_bid != null ? ` ($${p.x.settings.waiver_bid})` : '') : 'free agent'}`])
          : `<div class="empty">${mv.detail.some(x => x.x.type !== 'trade') ? 'No waiver or free-agent pickup has started a game yet.' : 'No waiver or free-agent adds yet.'}</div>`}
        <div class="legend"><p>Points count only once the player started for the team that added him.</p></div></section>
      <section class="panel s12"><header><div><span class="eyebrow">Best return since the deal ${honor('Trade of the Year')}</span><h2>Trade of the Year</h2></div></header>
        ${trades.length ? trades.map((tr, n) => `<div class="trade-yr${n === 0 ? ' lead' : ''}"><div class="when"><span class="tag trade">${n === 0 ? 'Leader' : 'Trade'}</span>
          <span>Week ${tr.x.leg || '?'}</span></div><div class="tsides">${tr.sides.map(s => { const t = M.teams[s.rid];
            return `<div class="tside"><div class="tsh">${teamCell(t)}<b class="${s.net > 0 ? 'up' : s.net < 0 ? 'down' : ''}">${s.net > 0 ? '+' : ''}${f1(s.net)}</b></div>
              ${s.got.map(d => `<div class="mv"><span class="sign add">+</span><span class="pname"${UI.pid(d.id)}>${esc(pname(d.id))}</span><span class="pmeta">${f1(d.v)} pts started since</span></div>`).join('')}
              ${s.picks.map(p => `<div class="mv"><span class="pchip r${p.round}">${p.round}</span><span class="pname">${p.season} round ${p.round}</span><span class="pmeta">not scored until drafted</span></div>`).join('')}</div>`; }).join('')}</div></div>`).join('')
          : '<div class="empty">No trades yet.</div>'}
        <div class="legend"><p>Each side's number is starting points from the players it received, minus what the players it gave up have scored since. Picks count once they're used.</p></div></section>
      <section class="panel s12"><header><div><span class="eyebrow">Each franchise's best</span><h2>Team MVPs</h2></div></header>
        <div class="mvps">${teamMvp.map(m => `<div class="prow"${UI.pid(m.id)}>${shot(m.id)}<div><div class="pname">${esc(pname(m.id))} <span class="pos ${esc(ppos(m.id))}">${esc(ppos(m.id))}</span></div>
          <div class="pmeta">${markSVG(m.t.f, 'mini')} ${esc(m.t.f.location)}</div></div><span class="pts">${f1(m.v)}<small>PTS</small></span></div>`).join('')}</div></section>
    </div>`;
  }

  // ---------- Prize money ----------
  // The pot, what each prize pays and who's in line, the weekly winners, and each team's money so far.
  function prizeMoney() {
    const z = Z(), teams = Object.values(M.teams), divs = M.league.divisions, W = M.league.regularSeasonWeeks;
    if (!z.buyIn) return '<div class="empty">No prize money is set. The commissioner adds it to league.json under "prizes".</div>';
    const money = UI.money, cash = UI.cash, pot = z.buyIn * teams.length;
    const ww = UI.weeklyWinners(M), banked = {}, wkWins = {};
    teams.forEach(t => { banked[t.id] = 0; wkWins[t.id] = 0; });
    ww.forEach(w => w.winners.forEach(t => { banked[t.id] += w.each; wkWins[t.id]++; }));
    const paid = ww.length * (z.weekly || 0);
    const total = (z.champion || 0) + (z.runnerUp || 0) + (z.division || 0) * divs.length + (z.weekly || 0) * W + (z.pointsLeader || 0) + (z.gmOfYear || 0);
    // Who's in line right now (nothing is in line before week 1 is final). Ties split.
    const byPf = teams.slice().sort((a, b) => b.pf - a.pf), pfLead = finals.length ? byPf.filter(t => t.pf === byPf[0].pf) : [];
    const divLead = finals.length ? divs.map(d => ({ d, t: teams.filter(t => t.division === d).sort(order)[0] })) : [];
    const inLine = {};
    teams.forEach(t => (inLine[t.id] = []));
    divLead.forEach(({ d, t }) => inLine[t.id].push({ what: d.name, v: z.division || 0 }));
    pfLead.forEach(t => inLine[t.id].push({ what: 'Points leader', v: (z.pointsLeader || 0) / pfLead.length }));
    const names = list => list.map(t => esc(t.f.location)).join(', ');
    const row = (name, how, amt, status) => `<tr><td><b class="prizename">${name}</b><div class="pmeta">${how}</div></td><td class="num">${amt}</td><td class="pmeta">${status}</td></tr>`;
    const pending = finals.length ? '' : 'Starts once week 1 is final';
    const board = teams.map(t => ({ t, b: banked[t.id], l: inLine[t.id], now: banked[t.id] + inLine[t.id].reduce((n, x) => n + x.v, 0) }))
      .sort((a, b) => (b.now - a.now) || (b.b - a.b) || (b.t.pf - a.t.pf));
    return `<div class="grid">
      <section class="panel s12"><header><div><span class="eyebrow">${teams.length} teams × ${money(z.buyIn)}</span><h2>The pot: ${money(pot)}</h2></div><span class="aside">${money(paid)} paid so far</span></header>
        <div class="tablewrap"><table class="st prizes"><thead><tr><th>Prize</th><th class="num">Pays</th><th>Right now</th></tr></thead><tbody>
          ${z.champion ? row('Champion', `Wins the title game. Playoffs start week ${W + 1}`, cash(z.champion), 'Decided in the playoffs') : ''}
          ${z.runnerUp ? row('Runner-up', 'Loses the title game', cash(z.runnerUp), 'Decided in the playoffs') : ''}
          ${z.division ? row('Division winners', 'Best record in the division, ties broken by points for. Paid whether or not they make the playoffs', `${divs.length} × ${cash(z.division)}`, pending || `Leading: ${divLead.map(x => `${esc(x.t.f.location)} <small>(${esc(x.d.name)})</small>`).join(', ')}`) : ''}
          ${z.weekly ? row('Weekly high score', `Highest score each week, weeks 1-${W}. A tie splits it`, `${W} × ${cash(z.weekly)}`, pending || `${ww.length} paid, ${W - ww.length} to go`) : ''}
          ${z.pointsLeader ? row('Points leader', 'Most points for over the regular season', cash(z.pointsLeader), pending || `Leading: ${names(pfLead)} (${f1(pfLead[0].pf)})`) : ''}
          ${z.gmOfYear ? row('GM of the Year', 'League vote after the season. The GM Index is the evidence', cash(z.gmOfYear), '<a href="#gm">See the GM Index</a>') : ''}
        </tbody><tfoot><tr><td><b>Total</b></td><td class="num strong">${money(total)}</td><td class="pmeta">${total === pot ? 'Every dollar of the pot is assigned' : `<span class="down">Payouts add up to ${money(total)}, but the pot is ${money(pot)}. Fix league.json.</span>`}</td></tr></tfoot></table></div>
        ${(z.honorsOnly || []).length ? `<div class="legend"><p><b>Honors without cash:</b> ${z.honorsOnly.map(esc).join(', ')}. They still go in the record books and follow the GM.</p></div>` : ''}</section>
      ${z.weekly ? `<section class="panel s6"><header><div><span class="eyebrow">${money(z.weekly)} a week</span><h2>Weekly high score</h2></div><span class="aside">${ww.length} of ${W} weeks</span></header>
        ${ww.length ? `<div class="tablewrap"><table class="st"><thead><tr><th>Week</th><th>Winner</th><th class="num">Pts</th><th class="num">Won</th></tr></thead>
          <tbody>${ww.map(w => `<tr><td class="rank">W${w.week}</td><td>${w.winners.map(t => `<a class="stteam" href="matchup.html#w${w.week}-t${t.id}">${markSVG(t.f, 'mini')}<span><b>${esc(t.f.location)}</b></span></a>`).join(' ')}</td>
            <td class="num strong">${f2(w.points)}</td><td class="num">${cash(w.each)}${w.winners.length > 1 ? ' <small>each</small>' : ''}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">The first weekly prize is paid once week 1 is final.</div>'}</section>` : ''}
      <section class="panel ${z.weekly ? 's6' : 's12'}"><header><div><span class="eyebrow">If the season ended today</span><h2>Money board</h2></div></header>
        <div class="tablewrap"><table class="st"><thead><tr><th>Team</th><th class="num">Banked</th><th class="hide-sm">In line for</th><th class="num">Today</th></tr></thead>
          <tbody>${board.map(({ t, b, l, now }) => `<tr><td>${teamCell(t)}${t.f.gm && t.f.gm.name ? `<div class="pmeta">${esc(t.f.gm.name)}</div>` : ''}</td>
            <td class="num">${b ? money(b) : '-'}${wkWins[t.id] ? ` <small>${wkWins[t.id]} wk</small>` : ''}</td>
            <td class="hide-sm pmeta">${l.length ? l.map(x => `${esc(x.what)} ${money(x.v)}`).join(' · ') : '-'}</td><td class="num strong">${now ? money(now) : '-'}</td></tr>`).join('')}</tbody></table></div>
        <div class="legend"><p><b>Banked</b> is weekly prize money already won. <b>In line for</b> is the division and points-leader money a team would collect if the regular season ended now.
          The championship, runner-up and GM of the Year are left out until they're decided.</p></div></section>
      ${careerBoard()}
    </div>`;
  }

  // All-time money list: every GM, every franchise they ran, completed seasons plus this season's weekly prizes.
  function careerBoard() {
    const list = Object.values(M.careers).sort((a, b) => (b.won - a.won) || (b.pf - a.pf));
    if (!list.length) return '';
    return `<section class="panel s12"><header><div><span class="eyebrow">Follows the GM</span><h2>Career earnings</h2></div><span class="aside">Since ${M.league.founded}</span></header>
      <div class="tablewrap"><table class="st"><thead><tr><th class="num">#</th><th>GM</th><th>Franchise now</th><th class="num hide-sm">Seasons</th><th class="num hide-sm">Weekly</th><th class="num">Won</th></tr></thead>
      <tbody>${list.map((c, i) => { const t = c.rid != null ? M.teams[c.rid] : null;
        return `<tr><td class="num rank">${i + 1}</td><td>${t ? `<a href="${tlink(t, '#earnings')}"><b>${esc(c.name || 'GM')}</b></a>` : `<b>${esc(c.name || 'Former GM')}</b>`}</td>
          <td>${t ? teamCell(t) : '<span class="pmeta">No longer in the league</span>'}</td><td class="num hide-sm">${c.seasons}</td>
          <td class="num hide-sm">${c.earnings.filter(e => e.kind === 'weekly').length}</td><td class="num strong">${c.won ? UI.money(c.won) : '-'}</td></tr>`; }).join('')}</tbody></table></div>
      <div class="legend"><p>Every prize a GM has won with any franchise. Completed seasons count everything paid; ${esc(M.state.season)} counts weekly prizes so far. Each GM's breakdown is on their team's <b>Earnings</b> tab.</p></div></section>`;
  }

  function route() {
    const tabs = [['points', 'Points race'], ['playoffs', 'Playoff race'], ['gm', 'GM Index'], ['players', 'Player awards'], ['prizes', 'Prizes & Ledger']];
    const tab = tabs.some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : 'points';
    document.getElementById('tabs').innerHTML = tabsHTML(tabs, tab);
    document.getElementById('content').innerHTML = { points, playoffs, gm, players, prizes: prizeMoney }[tab]();
    if (tab === 'prizes') ledger();
  }

  // The League ledger (js/ledger.js) sits under the prize tables. It needs the sign-in code, which only loads on devices
  // where someone has signed in; everyone else is told it's for signed-in members.
  function ledger() {
    const grid = document.querySelector('#content > .grid');
    if (!grid) return;
    grid.insertAdjacentHTML('beforeend', '<div class="s12" id="ledger-mount"></div>');
    const el = document.getElementById('ledger-mount');
    let on = false;
    try { on = localStorage.getItem('blitz.signedIn') === '1'; } catch (e) { /* private mode */ }
    const src = (document.querySelector('meta[name="blitz-ledger"]') || {}).content;
    if (!on || !src || !window.FIREBASE_CONFIG) {
      el.innerHTML = `<section class="panel ledger"><header><div><span class="eyebrow">League ledger · rule 6-4-3</span><h2>Members only</h2></div></header>
        <p>Dues, the prize fund and every payout are recorded here for league members. <a href="account.html">Sign in</a> to see it.</p></section>`;
      return;
    }
    import(new URL(src, document.baseURI).href).then(m => m.mount(el, M)).catch(e => { el.innerHTML = '<div class="error">Couldn\'t load the ledger.</div>'; console.error(e); });
  }

  boot('League · <strong>Awards race</strong>', m => {
    M = m;
    finals = UI.allGames(M, g => g.final);
    through = finals.length ? Math.max(...finals.map(g => g.week)) : 0;
    document.getElementById('hero').innerHTML = leagueHero(M, `${M.league.name} · ${M.state.season}`, 'Awards race', through ? `Through week ${through} · updates after every week` : 'Starts after week 1');
    route();
    addEventListener('hashchange', route);
  });
})();
