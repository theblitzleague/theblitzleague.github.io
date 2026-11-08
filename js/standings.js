/* Standings: by division, and the whole league with all-play records.
   Order: wins, then points for (same rule as js/data.js). Tabs: #divisions (default), #league. */
(function () {
  const { esc, f1, ord, rec } = UI;
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

  const TABS = [['divisions', 'Divisions'], ['league', 'League']];
  const RENDER = { divisions, league };

  function route() {
    const tab = RENDER[location.hash.slice(1)] ? location.hash.slice(1) : 'divisions';
    document.getElementById('tabs').innerHTML = `<div class="tabs"><div class="wrap" role="tablist">${TABS.map(([id, l]) =>
      `<a class="tab" role="tab" href="#${id}" aria-selected="${id === tab}">${l}</a>`).join('')}</div></div>`;
    document.getElementById('content').innerHTML = RENDER[tab]();
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
