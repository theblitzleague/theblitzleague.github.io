/* Standings: by division, and the whole league with all-play records.
   Order: wins, then points for (same rule as js/data.js). Tabs: #divisions (default), #league. */
(function () {
  const { esc, f1, f2, ord, rec } = UI;
  let M;

  const pct = t => { const g = t.wins + t.losses + t.ties; return g ? ((t.wins + t.ties / 2) / g).toFixed(3).replace(/^0/, '') : '.000'; };
  const teamLink = t => `team.html?team=${t.id}`;
  const divInk = UI.divInk;

  // All-play: each final week, a team "plays" all 11 others; beat every lower score.
  function allPlay() {
    const out = {};
    for (const t of Object.values(M.teams)) out[t.id] = { w: 0, l: 0 };
    for (let w = 1; w < M.current; w++) {
      const rows = (Object.values(M.teams).map(t => t.games.find(g => g.week === w && g.final)).filter(Boolean)).map(g => ({ id: g.me.roster_id, p: g.me.points }));
      for (const a of rows) for (const b of rows) if (a.id !== b.id) { if (a.p > b.p) out[a.id].w++; else if (a.p < b.p) out[a.id].l++; }
    }
    return out;
  }

  const order = (a, b) => (b.wins - a.wins) || (b.pf - a.pf);
  const streakCls = s => (s[0] === 'W' ? 'W' : s[0] === 'L' ? 'L' : '');

  function teamCell(t, nick) {
    return `<a class="stteam" href="${teamLink(t)}">${markSVG(t.f, 'mini')}<span><b>${esc(t.f.location)}</b>${nick && t.f.nickname ? ` <small>${esc(t.f.nickname)}</small>` : ''}</span></a>`;
  }

  function divisions() {
    const weeks = M.current - 1;
    return `<div class="grid">${M.league.divisions.map(d => {
      const teams = Object.values(M.teams).filter(t => t.division === d).sort(order);
      const lead = teams[0];
      return `<section class="panel s4 divpanel" style="--dc:${divInk(d)}">
      <header><div><span class="eyebrow">${esc(d.region)}${UI.prizes(M).division ? ` · Winner ${UI.cash(UI.prizes(M).division)}` : ''}</span><h2>${esc(d.name)}</h2></div>${divMarkHTML(d, 'divmark divmark-xl')}</header>
      <div class="tablewrap"><table class="st"><thead><tr><th class="num">#</th><th>Team</th><th class="num">W-L</th><th class="num">GB</th><th class="num">PF</th><th class="num">Div</th><th class="num">Strk</th></tr></thead>
      <tbody>${teams.map((t, i) => {
        const gb = ((lead.wins - t.wins) + (t.losses - lead.losses)) / 2;
        return `<tr><td class="num rank">${i + 1}</td><td>${teamCell(t)}</td><td class="num strong">${rec(t)}</td>
          <td class="num">${gb ? gb.toFixed(gb % 1 ? 1 : 0) : '-'}</td><td class="num">${f1(t.pf)}</td>
          <td class="num">${t.divRecord[0]}-${t.divRecord[1]}</td><td class="num"><span class="strk ${streakCls(t.streak)}">${esc(t.streak)}</span></td></tr>`; }).join('')}</tbody></table></div>
    </section>`; }).join('')}
    <p class="footnote s12">Through week ${weeks}. Ties are broken by points for. Division logos and colors come from the commissioner's branding files.</p>
  </div>`;
  }

  function league() {
    const ap = allPlay(), teams = Object.values(M.teams).sort(order), weeks = M.current - 1;
    const maxPf = Math.max(...teams.map(t => t.pf));
    return `<div class="grid"><section class="panel s12">
    <header><div><span class="eyebrow">All 12 franchises</span><h2>League table</h2></div><span class="aside">Through week ${weeks}</span></header>
    <div class="tablewrap"><table class="st wide"><thead><tr><th class="num">#</th><th>Team</th><th class="hide-sm">Division</th><th class="num">W-L</th><th class="num hide-sm">PCT</th>
      <th class="num">PF</th><th class="pfbar hide-sm"></th><th class="num hide-sm">PA</th><th class="num hide-sm">Diff</th><th class="num">All-play</th><th class="num hide-sm">Luck</th><th class="num">Strk</th></tr></thead>
    <tbody>${teams.map((t, i) => {
      const a = ap[t.id], apPct = a.w + a.l ? a.w / (a.w + a.l) : 0;
      const g = t.wins + t.losses + t.ties, expW = apPct * g, luck = t.wins - expW;
      const diff = t.pf - t.pa;
      return `<tr><td class="num rank">${i + 1}</td><td>${teamCell(t, true)}</td>
        <td class="hide-sm"><span class="divchip" style="--dc:${divInk(t.division)}">${divMarkHTML(t.division)}${esc(t.division.name)}</span></td>
        <td class="num strong">${rec(t)}</td><td class="num hide-sm">${pct(t)}</td><td class="num">${f1(t.pf)}</td>
        <td class="pfbar hide-sm"><i style="width:${(t.pf / maxPf * 100).toFixed(1)}%"></i></td>
        <td class="num hide-sm">${f1(t.pa)}</td><td class="num hide-sm ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : ''}${f1(diff)}</td>
        <td class="num">${a.w}-${a.l}</td><td class="num hide-sm ${luck >= 0.5 ? 'up' : luck <= -0.5 ? 'down' : ''}">${luck >= 0 ? '+' : ''}${luck.toFixed(1)}</td>
        <td class="num"><span class="strk ${streakCls(t.streak)}">${esc(t.streak)}</span></td></tr>`; }).join('')}</tbody></table></div>
    <div class="legend"><p><b>All-play</b> is each team's record if it had played every other team every week, from the actual weekly scores.
      <b>Luck</b> is real wins minus the wins that all-play rate would predict: positive means the schedule has been kind.</p></div>
  </section></div>`;
  }

  /* Playoffs (rule 7-1-2), NFL style: division winners seeds 1-3, wild cards 4-6, seeds 1-2 get a bye; Week 15 wild card (3 v 6, 4 v 5), Week 16 divisional round (1 plays
     the lowest seed left), Week 17 the Blitz Bowl and the third-place game. The bracket comes from the server (league/bracket,
     functions/index.js weekResults), which rebuilds it every morning from the official weeks, so it moves with the
     standings until Week 14 is official on its Tuesday. Before the server has written one, it is projected here. */
  function bracketData() {
    if (M.bracket && M.bracket.seeds && M.bracket.seeds.length) return M.bracket;
    // NFL style (7-1-2): division winners are seeds 1-3, then the three best other records as wild cards.
    const better = (a, b) => (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || b.pf - a.pf, all = Object.values(M.teams);
    const winners = M.league.divisions.map(d => all.filter(t => t.division === d).sort(better)[0]).filter(Boolean).sort(better);
    const wild = all.filter(t => !winners.includes(t)).sort(better).slice(0, 6 - winners.length);
    const seeds = [...winners.map(t => [t, 'Division winner']), ...wild.map(t => [t, 'Wild card'])].map(([t, how], i) => ({ team: t.id, seed: i + 1, w: t.wins, l: t.losses, t: t.ties, pf: t.pf, how }));
    const sd = n => seeds[n - 1].team, g = (week, a, b, label) => ({ week, a, b, aSeed: a && seeds.find(x => x.team === a).seed, bSeed: b && seeds.find(x => x.team === b).seed, label, final: false });
    return { projected: true, local: true, seeds, rounds: [{ week: 15, name: 'Wild card round', byes: [sd(1), sd(2)], games: [g(15, sd(3), sd(6), 'Wild card round'), g(15, sd(4), sd(5), 'Wild card round')] },
      { week: 16, name: 'Divisional round', games: [g(16, sd(1), null, 'Divisional round'), g(16, sd(2), null, 'Divisional round')] }, { week: 17, name: 'Championship', games: [g(17, null, null, 'Blitz Bowl'), g(17, null, null, 'Third-place game')] }] };
  }
  function playoffs() {
    const B = bracketData(), T = id => M.teams[id];
    const through = Math.max(0, ...Object.values(M.teams).map(t => t.games.filter(x => x.final).length));
    const slot = (id, seed, pts, win, final) => id && T(id)
      ? `<a class="br-team${final ? (win ? ' win' : ' out') : ''}" href="team.html?team=${id}"><span class="br-seed">${seed || ''}</span>${markSVG(T(id).f, 'mini')}<b>${esc(T(id).f.location)}</b><span class="br-pts">${pts != null && (final || pts) ? f2(pts) : ''}</span></a>`
      : `<div class="br-team tbd"><span class="br-seed">${seed || ''}</span><b>${seed ? '' : 'To be decided'}</b></div>`;
    const game = x => `<div class="br-game"><div class="br-label">${esc(x.label)} · Week ${x.week}${x.final ? ' · Final' : ''}</div>
      ${slot(x.a, x.aSeed, x.aPts, x.winner === x.a, x.final)}${slot(x.b, x.bSeed, x.bPts, x.winner === x.b, x.final)}
      ${x.a && x.b && !B.local ? `<a class="br-link" href="matchup.html#w${x.week}-t${x.a}">Matchup &rsaquo;</a>` : ''}</div>`;
    const [wc, sf, ch] = B.rounds;
    const byes = (wc.byes || []).map(id => { const s = B.seeds.find(x => x.team === id); return `<div class="br-game bye"><div class="br-label">First-round bye</div>${slot(id, s && s.seed, null, false, false)}</div>`; }).join('');
    const champ = B.champion && T(B.champion);
    return `<div class="grid">
    ${champ ? `<section class="panel s12 br-champ"><span class="eyebrow">${esc(M.state.season)} Blitz Bowl champion</span><h2>${markSVG(champ.f, 'mini')} ${esc(champ.f.location)}${champ.f.nickname ? ' ' + esc(champ.f.nickname) : ''}</h2></section>` : ''}
    <section class="panel s12"><header><div><span class="eyebrow">${B.projected ? `Projected · if the season ended today${through ? ` (through Week ${through})` : ''}` : 'Set · Week 14 is official'}</span><h2>Playoff bracket</h2></div>
      <span class="aside">3 division winners + 3 wild cards · seeds 1-2 get a bye</span></header>
      <div class="bracket">
        <div class="br-col"><div class="br-round">Wild card round · Week 15</div>${byes}${wc.games.map(game).join('')}</div>
        <div class="br-col"><div class="br-round">Divisional round · Week 16</div>${sf.games.map(game).join('')}</div>
        <div class="br-col"><div class="br-round">Championship · Week 17</div>${game(ch.games[0])}<div class="br-third">${game(ch.games[1])}</div></div>
      </div>
      <p class="footnote">NFL style (rule 7-1-2): the three division winners are seeds 1-3 by record, then the three best other records are the wild cards, seeds 4-6. Ties are broken by points for. Seeds 1 and 2 get a bye. In the divisional round the 1 seed plays the lowest seed left. A tied playoff game goes to the higher seed. The bracket updates each Tuesday morning once the week's scores are official (2-2-3).</p></section>
    <section class="panel s12"><header><div><h2>Seeds</h2></div></header>
      <div class="tablewrap"><table class="st"><thead><tr><th>Seed</th><th>Team</th><th>How</th><th class="num">W-L</th><th class="num">PF</th></tr></thead>
      <tbody>${B.seeds.map(s => `<tr><td class="rank">${s.seed}</td><td><a class="stteam" href="team.html?team=${s.team}">${markSVG(T(s.team).f, 'mini')}<span><b>${esc(T(s.team).f.location)}</b></span></a></td><td class="pmeta">${esc(s.how || '')}${s.how === 'Division winner' && T(s.team).division ? ` · ${esc(T(s.team).division.name)}` : ''}</td><td class="num">${s.w}-${s.l}${s.t ? '-' + s.t : ''}</td><td class="num">${f1(s.pf)}</td></tr>`).join('')}</tbody></table></div></section>
    </div>`;
  }

  const TABS = [['divisions', 'Divisions'], ['league', 'League'], ['playoffs', 'Playoffs']];
  const RENDER = { divisions, league, playoffs };

  function route() {
    const tab = RENDER[location.hash.slice(1)] ? location.hash.slice(1) : 'divisions';
    document.getElementById('tabs').innerHTML = `<div class="tabs"><div class="wrap" role="tablist">${TABS.map(([id, l]) =>
      `<a class="tab" role="tab" href="#${id}" aria-selected="${id === tab}">${l}</a>`).join('')}</div></div>`;
    document.getElementById('content').innerHTML = RENDER[tab]();
    paintHelmets(document).catch(() => {});
  }

  function hero() {
    const lg = M.league;
    return `<section class="lhero">${lg.logo ? `<img class="hero-watermark" src="${esc(lg.logo)}" alt="" aria-hidden="true">` : ''}<div class="wrap">
      ${lg.logo ? `<img class="lhero-logo" src="${esc(lg.logo)}" alt="${esc(lg.name)}">` : ''}
      <div><span class="eyebrow">${esc(lg.name)} · ${esc(M.state.season)}</span><h1>Standings</h1>
      <div class="nick">Week ${M.current} · ${M.league.divisions.length} divisions · ${Object.keys(M.teams).length} franchises</div></div>
    </div></section>`;
  }

  async function start() {
    try {
      M = await Hub.load();
      document.getElementById('sample-flag').hidden = M.live;
      UI.myTeam(M);
      document.getElementById('season').innerHTML = `<strong>${esc(M.state.season)} season</strong><span>Week ${M.current}</span>`;
      document.getElementById('crumb').innerHTML = `League · <strong>Standings</strong>`;
      document.getElementById('hero').innerHTML = hero();
      route();
      addEventListener('hashchange', route);
    } catch (e) {
      document.getElementById('content').innerHTML = `<div class="error">Couldn't load league data. ${esc(e.message)}</div>`;
      console.error(e);
    }
  }
  start();
})();
