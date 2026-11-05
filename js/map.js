/* League map: every candidate location from league.json, with the franchise (if any) that holds it.
   Status: claimed = franchise with a final identity; placeholder = stand-in franchise, location not actually picked; open = available.
   City positions use the same projection as js/us-map.js (d3.geoAlbersUsa lower-48: Albers conic equal-area,
   parallels 29.5/45.5, rotate 96, center [-0.6, 38.7], scale 1300, translate [487.5, 305]). */
(function () {
  const { esc, accentFor, leagueHero, boot } = UI;
  let M;
  const rad = Math.PI / 180;
  const p0 = 29.5 * rad, p1 = 45.5 * rad, n = (Math.sin(p0) + Math.sin(p1)) / 2, c = 1 + Math.sin(p0) * (2 * n - Math.sin(p0)), r0 = Math.sqrt(c) / n;
  const raw = (l, p) => { const r = Math.sqrt(c - 2 * n * Math.sin(p)) / n; return [r * Math.sin(l * n), r0 - r * Math.cos(l * n)]; };
  const C = raw(-0.6 * rad, 38.7 * rad);
  function project(lon, lat) {
    const [x, y] = raw((lon + 96) * rad, lat * rad);
    return [487.5 + 1300 * (x - C[0]), 305 - 1300 * (y - C[1])];
  }

  const divOf = region => M.league.divisions.find(d => d.key === region);
  const ink = UI.divInk;

  function locations() {
    return M.league.locations.map(l => {
      const t = Object.values(M.teams).find(x => x.f.location === l.name);
      const status = !t ? 'open' : t.f.placeholder ? 'placeholder' : 'claimed';
      return { ...l, t, status, d: divOf(l.region), xy: project(l.lon, l.lat) };
    });
  }

  function marker(L) {
    const [x, y] = L.xy, col = L.t ? accentFor(L.t.f) : ink(L.d);
    const [dx, dy] = L.label || [L.status === 'claimed' ? 23 : 12, 5];
    const custom = !!L.label, anchor = dx < 0 ? 'end' : 'start';
    const label = L.t && L.t.f.nickname ? `${L.name} ${L.t.f.nickname}` : L.name;
    const lead = custom ? `<line x1="0" y1="0" x2="${dx - (dx < 0 ? -4 : 4)}" y2="${dy - 4}" class="lead"/>` : '';
    const href = L.t ? `team.html?team=${L.t.id}` : null;
    let dot;
    if (L.status === 'claimed') {
      const mark = L.t.f.logos && (L.t.f.logos.mark || L.t.f.logos.primary);
      dot = `<circle r="17" class="halo" style="fill:${ink(L.d)}"/><circle r="13" class="claimed" style="stroke:${col}"/>${mark ? `<image href="${esc(mark)}" x="-11" y="-11" width="22" height="22"/>` : ''}`;
    } else if (L.status === 'placeholder') dot = `<circle r="7" class="ph" style="fill:${ink(L.d)}"/>`;
    else dot = `<circle r="5" class="open" style="stroke:${ink(L.d)}"/>`;
    const text = `<text x="${dx}" y="${dy}" text-anchor="${anchor}" class="lbl ${L.status}">${esc(label)}</text>`;
    const g = `<g class="loc ${L.status}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">${lead}${dot}${text}</g>`;
    return href ? `<a href="${href}">${g}</a>` : g;
  }

  function render() {
    const locs = locations();
    const order = { open: 0, placeholder: 1, claimed: 2 };       // claimed drawn last, on top
    // Extra room on the right (Atlantic) for the crowded Northeast labels.
    const svg = `<svg class="usmap" viewBox="0 0 1075 610" role="img" aria-label="Map of Blitz League franchise locations">
      <path d="${US_MAP.nation}" class="nation"/>
      ${US_MAP.states.map(s => `<path d="${s.d}" class="state"><title>${esc(s.name)}</title></path>`).join('')}
      ${locs.slice().sort((a, b) => order[a.status] - order[b.status]).map(marker).join('')}
    </svg>`;
    const counts = s => locs.filter(l => l.status === s).length;
    const lists = M.league.divisions.map(d => {
      const ls = locs.filter(l => l.region === d.key).sort((a, b) => order[b.status] - order[a.status] || a.name.localeCompare(b.name));
      return `<section class="panel s4 divpanel" style="--dc:${ink(d)}"><header><div><span class="eyebrow">${esc(d.region)}</span><h2>${esc(d.name)}</h2></div>${divMarkHTML(d, 'divmark divmark-lg')}</header>
        <div class="plist">${ls.map(l => `<${l.t ? `a href="team.html?team=${l.t.id}"` : 'div'} class="prow maprow">
          ${l.t ? markSVG(l.t.f, 'shot') : '<span class="shot opendot"></span>'}
          <div><div class="pname">${esc(l.name)}${l.t && l.t.f.nickname ? ` <small>${esc(l.t.f.nickname)}</small>` : ''}</div>
          <div class="pmeta">${l.status === 'claimed' ? 'Claimed' : l.status === 'placeholder' ? 'Held by a placeholder franchise' : 'Open'}</div></div>
          <span class="tag ${l.status === 'claimed' ? 'ok' : l.status === 'placeholder' ? 'q' : 'taxi'}">${l.status === 'claimed' ? 'Claimed' : l.status === 'placeholder' ? 'Placeholder' : 'Open'}</span>
        </${l.t ? 'a' : 'div'}>`).join('')}</div></section>`;
    }).join('');
    document.getElementById('content').innerHTML = `<div class="grid">
      <section class="panel s12"><header><div><span class="eyebrow">${locs.length} locations · 3 regions</span><h2>Franchise map</h2></div>
        <div class="maplegend"><span><i class="lg claimed"></i>Claimed (${counts('claimed')})</span><span><i class="lg ph"></i>Placeholder (${counts('placeholder')})</span><span><i class="lg open"></i>Open (${counts('open')})</span></div></header>
        <div class="mapwrap">${svg}</div></section>
      ${lists}
      <p class="footnote s12">Locations come from the league's planning brief: about six per region, four get picked. Placeholder franchises hold a spot only so the site has twelve teams to show; they are not picks.</p>
    </div>`;
  }

  boot('League · <strong>League map</strong>', m => {
    M = m;
    document.getElementById('hero').innerHTML = leagueHero(M, `${M.league.name} · ${M.league.divisions.length} regions`, 'League map', `Where the franchises play`);
    render();
  });
})();
