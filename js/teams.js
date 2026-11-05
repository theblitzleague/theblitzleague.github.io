/* Franchises: every club by division, all-time standings, and GM lineage.
   History belongs to the franchise, not the GM: franchises.json "pastGms" plus the current GM.
   Completed seasons can be archived per franchise in franchises.json "seasons" ([{season, wins, losses, ties, pf, pa, result}]). */
(function () {
  const { esc, f1, rec, wash, accentFor, primaryLogo, leagueHero, tabsHTML, boot } = UI;
  let M;

  // All-time = archived seasons + the season in progress.
  function allTime(t) {
    const past = t.f.seasons || [];
    const sum = k => past.reduce((n, s) => n + (s[k] || 0), 0);
    return {
      seasons: past.length + 1, wins: sum('wins') + t.wins, losses: sum('losses') + t.losses, ties: sum('ties') + t.ties,
      pf: sum('pf') + t.pf, titles: past.filter(s => s.result === 'champion').length,
      playoffs: past.filter(s => s.result && s.result !== 'missed').length,
    };
  }
  const gms = t => [...(t.f.pastGms || []), ...(t.f.gm && t.f.gm.name ? [{ name: t.f.gm.name, from: t.f.gm.since, current: true }] : [])];

  function cards() {
    return `<div class="grid">${M.league.divisions.map(d => `<section class="panel s12 divpanel" style="--dc:${UI.divInk(d)}">
      <header><div><span class="eyebrow">${esc(d.region)}</span><h2>${esc(d.name)}</h2></div>${divMarkHTML(d, 'divmark divmark-xl')}</header>
      <div class="fcards">${Object.values(M.teams).filter(t => t.division === d).sort((a, b) => a.f.location.localeCompare(b.f.location)).map(t => {
        const g = (t.f.gm && t.f.gm.name) || 'Open seat';
        return `<a class="fcard" href="team.html?team=${t.id}" style="--lw:${wash(t.f)};--lc:${accentFor(t.f)}">
          <div class="fart">${helmetHTML(t.f, { facing: 'right', variant: 'home' })}${primaryLogo(t.f, 'flogo')}</div>
          <div class="fbody"><b>${esc(t.f.location)}</b><small>${t.f.nickname ? esc(t.f.nickname) : 'Name to be decided'}</small>
            <div class="fmeta"><span>Est. ${t.f.founded}</span><span>GM ${esc(g)}</span><span>${rec(t)}</span></div>
            ${t.f.placeholder ? '<span class="tag q">Placeholder: location not picked yet</span>' : ''}</div></a>`;
      }).join('')}</div></section>`).join('')}</div>`;
  }

  function table() {
    const rows = Object.values(M.teams).map(t => ({ t, a: allTime(t) })).sort((x, y) => (y.a.titles - x.a.titles) || (y.a.wins - x.a.wins) || (y.a.pf - x.a.pf));
    return `<section class="panel"><header><div><span class="eyebrow">Since ${M.league.founded}</span><h2>All-time standings</h2></div><span class="aside">Includes the season in progress</span></header>
    <div class="tablewrap"><table class="st wide"><thead><tr><th class="num">#</th><th>Franchise</th><th class="num">Seasons</th><th class="num">W-L</th><th class="num hide-sm">PCT</th><th class="num">PF</th><th class="num">Titles</th><th class="num hide-sm">Playoffs</th><th class="num hide-sm">GMs</th></tr></thead>
    <tbody>${rows.map(({ t, a }, i) => { const g = a.wins + a.losses + a.ties;
      return `<tr><td class="num rank">${i + 1}</td><td><a class="stteam" href="team.html?team=${t.id}#history">${markSVG(t.f, 'mini')}<span><b>${esc(t.f.location)}</b></span></a></td>
        <td class="num">${a.seasons}</td><td class="num strong">${a.wins}-${a.losses}${a.ties ? '-' + a.ties : ''}</td><td class="num hide-sm">${g ? ((a.wins + a.ties / 2) / g).toFixed(3).replace(/^0/, '') : '.000'}</td>
        <td class="num">${f1(a.pf)}</td><td class="num strong">${a.titles}</td><td class="num hide-sm">${a.playoffs}</td><td class="num hide-sm">${gms(t).length}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="legend"><p>Ordered by titles, then wins, then points. Finished seasons are archived per franchise, so a club's record stays with it when a GM leaves.</p></div>
  </section>`;
  }

  function lineage() {
    return `<section class="panel"><header><div><span class="eyebrow">History belongs to the franchise</span><h2>GM lineage</h2></div></header>
    <div class="lineage">${Object.values(M.teams).sort((a, b) => a.f.location.localeCompare(b.f.location)).map(t => {
      const list = gms(t);
      return `<div class="lrowf"><a class="stteam" href="team.html?team=${t.id}#front-office">${markSVG(t.f, 'mini')}<span><b>${esc(t.f.location)}</b></span></a>
        <div class="gmchain">${list.length ? list.map(g => `<span class="gmlink${g.current ? ' cur' : ''}"><b>${esc(g.name)}</b><small>${g.from || '?'}-${g.to || 'present'}</small></span>`).join('<i>&rarr;</i>')
          : '<span class="pmeta">No GM yet. The seat opens when the location draft happens.</span>'}</div></div>`;
    }).join('')}</div></section>`;
  }

  function route() {
    const tab = ['franchises', 'all-time', 'gm-lineage'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'franchises';
    document.getElementById('tabs').innerHTML = tabsHTML([['franchises', 'Franchises'], ['all-time', 'All-time standings'], ['gm-lineage', 'GM lineage']], tab);
    document.getElementById('content').innerHTML = { franchises: cards, 'all-time': table, 'gm-lineage': lineage }[tab]();
    paintHelmets(document).catch(e => console.error(e));
  }

  boot('League · <strong>Franchises</strong>', m => {
    M = m;
    const claimed = Object.values(M.teams).filter(t => !t.f.placeholder).length;
    document.getElementById('hero').innerHTML = leagueHero(M, `${M.league.name} · Est. ${M.league.founded}`, 'Franchises',
      `${Object.keys(M.teams).length} franchises · ${claimed} with a final identity · ${Object.keys(M.teams).length - claimed} placeholders`);
    route();
    addEventListener('hashchange', route);
  });
})();
