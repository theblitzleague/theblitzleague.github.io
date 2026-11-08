/* Draft: future pick capital, pick ownership grid, pick trades, and past draft boards (from Sleeper when live).
   Ownership rule (Sleeper's traded_picks): roster_id = original owner, owner_id = current owner; untraded picks stay home. */
(function () {
  const { esc, rec, leagueHero, tabsHTML, boot } = UI;
  let M, seasons;
  const P = id => M.players[id] || { full_name: `Player ${id}`, position: '?' };
  const name = rid => (M.teams[rid] ? M.teams[rid].f.location : `Team ${rid}`);
  const teamsOrdered = () => Object.values(M.teams).sort((a, b) => a.f.location.localeCompare(b.f.location));

  // owner of (season, round, original team)
  function owner(season, round, rid) {
    const t = M.tradedPicks.find(p => p.season === season && p.round === round && p.roster_id === rid);
    return t ? t.owner_id : rid;
  }
  function picksOwnedBy(rid, season) {
    const out = [];
    for (let r = 1; r <= M.league.draftRounds; r++) for (const t of Object.values(M.teams)) if (owner(season, r, t.id) === rid) out.push({ round: r, from: t.id });
    return out;
  }

  function capital() {
    const rows = teamsOrdered().map(t => {
      const per = seasons.map(s => picksOwnedBy(t.id, s));
      const all = per.flat();
      const firsts = all.filter(p => p.round === 1).length, seconds = all.filter(p => p.round === 2).length;
      const extra = all.filter(p => p.from !== t.id).length;
      const gone = seasons.reduce((n, s) => n + Array.from({ length: M.league.draftRounds }, (_, i) => owner(s, i + 1, t.id) !== t.id).filter(Boolean).length, 0);
      return { t, per, total: all.length, firsts, seconds, extra, gone };
    }).sort((a, b) => (b.firsts - a.firsts) || (b.total - a.total) || (b.seconds - a.seconds));
    const chip = (p, rid) => `<span class="pchip r${p.round}${p.from !== rid ? ' via' : ''}" title="Round ${p.round}${p.from !== rid ? ' via ' + esc(name(p.from)) : ''}">${p.round}${p.from !== rid ? `<i>${esc(M.teams[p.from].f.abbr)}</i>` : ''}</span>`;
    return `<section class="panel"><header><div><span class="eyebrow">${seasons[0]}-${seasons[seasons.length - 1]} rookie drafts</span><h2>Draft capital</h2></div><span class="aside">${M.league.draftRounds} rounds a year</span></header>
    <div class="tablewrap"><table class="st wide"><thead><tr><th>Team</th>${seasons.map(s => `<th>${s}</th>`).join('')}<th class="num">Picks</th><th class="num">1sts</th><th class="num">2nds</th><th class="num hide-sm">Acquired</th><th class="num hide-sm">Dealt</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td><a class="stteam" href="team.html?team=${r.t.id}#draft-capital">${markSVG(r.t.f, 'mini')}<span><b>${esc(r.t.f.location)}</b></span></a></td>
      ${r.per.map(ps => `<td><div class="pchips">${ps.sort((a, b) => a.round - b.round).map(p => chip(p, r.t.id)).join('')}</div></td>`).join('')}
      <td class="num strong">${r.total}</td><td class="num strong">${r.firsts}</td><td class="num">${r.seconds}</td><td class="num hide-sm up">${r.extra || '-'}</td><td class="num hide-sm down">${r.gone || '-'}</td></tr>`).join('')}</tbody></table></div>
    <div class="legend"><p>Each chip is a pick, by round. A chip with a team code came from that team. Sorted by first-rounders, then total picks.
      Pick order within a round isn't set until the season ends.</p></div>
  </section>`;
  }

  function ownership(season) {
    const R = M.league.draftRounds;
    return `<section class="panel"><header><div><span class="eyebrow">Who holds each pick</span><h2>${season} pick ownership</h2></div>
      <div class="seg">${seasons.map(s => `<a href="#own-${s}" class="${s === season ? 'on' : ''}">${s}</a>`).join('')}</div></header>
    <div class="tablewrap"><table class="st owngrid"><thead><tr><th>Original team</th>${Array.from({ length: R }, (_, i) => `<th>Round ${i + 1}</th>`).join('')}</tr></thead>
    <tbody>${teamsOrdered().map(t => `<tr><td><a class="stteam" href="team.html?team=${t.id}">${markSVG(t.f, 'mini')}<span><b>${esc(t.f.location)}</b></span></a></td>
      ${Array.from({ length: R }, (_, i) => { const o = owner(season, i + 1, t.id);
        return o === t.id ? '<td><span class="own">Own</span></td>' : `<td class="moved"><a href="team.html?team=${o}#draft-capital">${markSVG(M.teams[o].f, 'mini')} ${esc(name(o))}</a></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
  </section>`;
  }

  function trades() {
    const list = M.transactions.filter(x => (x.draft_picks || []).length);
    if (!list.length) return '<section class="panel"><div class="empty">No picks have been traded yet.</div></section>';
    return `<section class="panel"><header><div><span class="eyebrow">${list.length} trade${list.length === 1 ? '' : 's'}</span><h2>Pick trades</h2></div></header>
    ${list.map(x => { const d = new Date(x.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `<div class="tx"><div class="when"><span class="tag trade">Trade</span><span>${esc(d)}</span></div><div class="moves">
        ${x.draft_picks.map(p => `<div class="mv"><span class="pchip r${p.round}">${p.round}</span><span class="pname">${p.season} round ${p.round}</span>
          <span class="pmeta">${esc(name(p.roster_id))}'s pick · ${esc(name(p.previous_owner_id))} &rarr; <b>${esc(name(p.owner_id))}</b></span></div>`).join('')}
        ${Object.entries(x.adds || {}).map(([id, r]) => `<div class="mv"><span class="sign add">+</span><span class="pname"${UI.pid(id)}>${esc(P(id).full_name)}</span><span class="pmeta">to ${esc(name(r))}</span></div>`).join('')}
      </div></div>`; }).join('')}
  </section>`;
  }

  // Finished Draft Room drafts (Firestore drafts/*, status "done"; public read): the official one first, then newest first.
  let hubDrafts = null;
  async function loadHubDrafts() {
    const c = window.FIREBASE_CONFIG; if (!c) return [];
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${c.projectId}/databases/(default)/documents:runQuery?key=${c.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'drafts' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'done' } } }, limit: 50 } }) });
    if (!r.ok) throw new Error(`the database answered ${r.status}`);
    const v = x => (x == null ? null : 'stringValue' in x ? x.stringValue : 'integerValue' in x ? +x.integerValue : 'doubleValue' in x ? x.doubleValue : 'booleanValue' in x ? x.booleanValue
      : 'arrayValue' in x ? (x.arrayValue.values || []).map(v) : 'mapValue' in x ? Object.fromEntries(Object.entries(x.mapValue.fields || {}).map(([k, y]) => [k, v(y)])) : null);
    return (await r.json()).filter(x => x.document).map(x => ({ id: x.document.name.split('/').pop(), ...v({ mapValue: { fields: x.document.fields } }) }))
      .sort((a, b) => (!!b.official - !!a.official) || (b.updated || 0) - (a.updated || 0));   // the official draft first
  }
  function hubBoard(d, open) {
    const T = d.teams.length, when = new Date(d.officialAt || d.updated || d.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const tag = d.official ? '<span class="tag ok">Official · league rosters</span>' : d.practice ? '<span class="tag">Mock</span>' : '<span class="tag">Official draft</span>';
    const cells = d.picks.map((p, n) => { const pl = P(p.p), t = M.teams[p.t];
      return `<div class="bpick pos-${esc(pl.position)}"${UI.pid(p.p)}><span class="pno">${Math.floor(n / T) + 1}.${String(n % T + 1).padStart(2, '0')}</span><b>${esc(pl.full_name)}</b><span class="pmeta">${esc(pl.position)} · ${t ? esc(t.f.abbr) : ''}</span></div>`; }).join('');
    return `<details class="panel hubdraft"${open ? ' open' : ''}><summary><div><span class="eyebrow">${esc(d.kind === 'rookie' ? 'Rookie draft' : 'Startup draft')} · ${esc(when)}</span><h2>${esc(d.name)}</h2></div>
      <span class="aside">${tag} ${d.picks.length} picks · ${d.rounds} rounds</span></summary>
      <div class="board-grid" style="--cols:${T}">${D_HEAD(d)}${cells}</div>
      <p class="footnote">Linear order: the same team order every round (rule 8-2-1). <a href="draftroom.html?d=${esc(d.id)}">Open in the draft room</a></p></details>`;
  }
  const D_HEAD = d => d.teams.map(t => `<div class="bhead">${M.teams[t] ? markSVG(M.teams[t].f, 'mini') : ''}<span>${esc(M.teams[t] ? M.teams[t].f.abbr : t)}</span></div>`).join('');
  function results() {
    if (hubDrafts === null) {
      loadHubDrafts().then(list => { hubDrafts = list; }).catch(e => { hubDrafts = { error: e.message }; })
        .then(() => (window.NFL ? NFL.fillPlayers(M) : null)).then(() => { if (location.hash.slice(1) === 'results') route(); });
      return '<div class="loading">Loading past drafts</div>';
    }
    const sleeper = M.drafts.filter(d => (d.picks || []).length);
    const hub = Array.isArray(hubDrafts) ? hubDrafts : [];
    const err = hubDrafts && hubDrafts.error ? `<div class="error">Couldn't load the Draft Room's drafts (${esc(hubDrafts.error)}).</div>` : '';
    if (!sleeper.length && !hub.length) return `${err}<section class="panel"><header><div><span class="eyebrow">Draft boards</span><h2>Past drafts</h2></div></header>
      <div class="empty">No drafts have been finished yet. Every completed Draft Room draft, mock or official, shows up here with its full board.</div></section>`;
    return err + hub.map((d, i) => hubBoard(d, i === 0)).join('') + sleeper.map(d => {
      const rounds = Math.max(...d.picks.map(p => p.round));
      return `<section class="panel"><header><div><span class="eyebrow">${esc(d.season)} · ${esc(d.type || 'draft')}</span><h2>${esc(d.metadata && d.metadata.name || d.season + ' draft')}</h2></div><span class="aside">${d.picks.length} picks</span></header>
      <div class="board-grid" style="--cols:${Math.max(...d.picks.map(p => p.draft_slot))}">${Array.from({ length: rounds }, (_, r) => d.picks.filter(p => p.round === r + 1).sort((a, b) => a.pick_no - b.pick_no).map(p => {
        const pl = P(p.player_id), t = M.teams[p.roster_id];
        return `<div class="bpick pos-${esc(pl.position)}"${UI.pid(p.player_id)}><span class="pno">${p.round}.${String(p.draft_slot).padStart(2, '0')}</span><b>${esc(pl.full_name)}</b><span class="pmeta">${esc(pl.position)} · ${t ? esc(t.f.abbr) : ''}</span></div>`; }).join('')).join('')}</div></section>`;
    }).join('');
  }

  function route() {
    const h = location.hash.slice(1);
    const tab = h.startsWith('own') ? 'ownership' : ['capital', 'trades', 'results'].includes(h) ? h : 'capital';
    const season = h.startsWith('own-') && seasons.includes(h.slice(4)) ? h.slice(4) : seasons[0];
    document.getElementById('tabs').innerHTML = tabsHTML([['capital', 'Capital'], ['own-' + seasons[0], 'Pick ownership'], ['trades', 'Pick trades'], ['results', 'Past drafts']],
      tab === 'ownership' ? 'own-' + seasons[0] : tab);
    document.getElementById('content').innerHTML = `<a class="dr-enter" href="draftroom.html"><b>Draft room</b><span>Practice drafts now; the startup draft on March 20-21, 2027 &rsaquo;</span></a>`
      + (M.hub ? `<a class="dr-enter dr-off" href="draftroom.html?d=${esc(M.hub.source || '')}"><b>Official draft</b><span>${esc(M.hub.name || '')}${M.hub.at ? `, made official ${esc(new Date(M.hub.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}` : ''}. Its picks are the league rosters now. See the board &rsaquo;</span></a>` : '')
      + { capital, ownership: () => ownership(season), trades, results }[tab]();
  }

  boot('League · <strong>Draft</strong>', m => {
    M = m;
    const first = +M.state.season + 1;
    seasons = Array.from({ length: M.league.futurePickSeasons }, (_, i) => String(first + i));
    document.getElementById('hero').innerHTML = leagueHero(M, `${M.league.name} · Rookie drafts`, 'Draft', `${seasons[0]}-${seasons[seasons.length - 1]} · ${M.league.draftRounds} rounds · ${M.tradedPicks.length} pick${M.tradedPicks.length === 1 ? '' : 's'} traded`);
    route();
    addEventListener('hashchange', route);
  });
})();
