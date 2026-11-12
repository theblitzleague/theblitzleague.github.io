/* Team page. Renders one franchise from the Hub model, in that franchise's colors. */
(function () {
  const TABS = [
    ['overview', 'Overview'], ['depth-chart', 'Depth Chart'], ['roster', 'Roster'], ['schedule', 'Schedule'],
    ['draft-capital', 'Draft Capital'], ['transactions', 'Transactions'], ['trades', 'Trades'], ['front-office', 'Front Office'],
  ];
  const { POS_ORDER, SIL, esc, f1, f2, ord, SLOT_LABEL, lum, shot, teamName, rec, status, pmeta, wash, accentFor } = UI;

  let M, T;
  const P = id => M.players[id] || { full_name: `Player ${id}`, position: '?' };
  // Honors rack: the championship trophy and one division mark per division won, each with a count.
  // Only what's been won shows; with nothing won the rack is left out entirely.
  function honorsRack(titles, divs) {
    const divById = Object.fromEntries(M.league.divisions.map(d => [d.id, d]));
    const list = s => s.map(x => x.season || x).join(', ');
    const item = (art, n, label, seasons) => `<div class="honor" title="${esc(`${label}: ${seasons}`)}">${art}<b>×${n}</b><span>${esc(label)}</span></div>`;
    const byDiv = {};
    divs.forEach(d => (byDiv[d.division] = byDiv[d.division] || []).push(d));
    const items = [
      ...(titles.length ? [item(`<img class="honor-art" src="${esc(M.league.trophy)}" alt="">`, titles.length, 'Champion', list(titles))] : []),
      ...Object.entries(byDiv).map(([id, w]) => { const d = divById[id]; return item(divMarkHTML(d, 'honor-art'), w.length, d ? d.name : 'Division', list(w)); })];
    return items.length ? `<div class="honors">${items.join('')}</div>` : '';
  }
  const recOf = c => `${c.wins}-${c.losses}${c.ties ? '-' + c.ties : ''}`;
  // Every season a GM played: completed ones from history.json (at that season's buy-in), then the one in progress.
  function gmSeasons(car) {
    const out = M.history.flatMap(s => Object.entries(s.teams || {}).filter(([, e]) => e.gm === car.key)
      .map(([rid]) => ({ season: s.season, rid: +rid, buyIn: (s.prizes || M.league.prizes || {}).buyIn || 0 })));
    if (car.current) out.push({ season: M.state.season, rid: car.rid, buyIn: UI.prizes(M).buyIn || 0, current: true });
    return out;
  }

  const height = h => (h && /^\d+$/.test(h) ? `${Math.floor(h / 12)}'${h % 12}"` : h || '');

  // Season points per player, counted only from weeks they were in the lineup.
  function seasonPoints() {
    const out = {};
    // Hub rosters (an official Draft Room draft) don't match the placeholder weeks, so show each player's real season
    // in League scoring instead of points scored as this team's starter.
    if (M.hub && M.seasonStats) {
      for (const id of T.roster.players) { const s = M.seasonStats[id]; if (s && s[0]) out[id] = { pts: s[1], gp: s[0] }; }
      return out;
    }
    for (const g of T.games.filter(g => g.final)) {
      (g.me.starters || []).forEach((id, i) => {
        const v = (g.me.starters_points || [])[i];
        if (v == null) return;
        const o = out[id] || (out[id] = { pts: 0, gp: 0 });
        o.pts += v; o.gp++;
      });
    }
    return out;
  }

  /* ---------- Shell: hero, week strip, tabs ---------- */
  function hero() {
    const t = T, d = t.division, now = t.games.find(g => g.live);
    const gm = t.f.gm || {};
    const wm = t.f.logos && t.f.logos.primary;
    const crest = t.f.logos && t.f.logos.primaryWide ? t.f.logos.primary : null;   // a wide crest takes the helmet's spot (helmets are for faceoffs)
    return `<section class="hero${t.f.banner ? ' has-banner' : ''}">${t.f.banner ? `<img class="hero-banner" src="${esc(t.f.banner)}" alt="" aria-hidden="true">` : ''}${wm && !t.f.banner ? `<img class="hero-watermark" src="${esc(wm)}" alt="" aria-hidden="true">` : ''}<div class="wrap">
  ${crest ? `<img class="hero-crest" src="${esc(crest)}" alt="${esc(teamName(t))} crest">` : helmetHTML(t.f, { facing: 'right' })}
  <div class="id-block${crest ? ' no-mark' : ''}">
    ${crest ? '' : t.f.logos && t.f.logos.primary ? `<img class="mark logo-img" src="${esc(t.f.logos.primary)}" alt="${esc(teamName(t))} primary logo">` : markSVG(t.f)}
    <div><span class="eyebrow">${divMarkHTML(d)}${esc(d.name)} · ${esc(d.region)}</span><h1>${esc(teamName(t))}</h1></div>
    <div class="nick">${t.f.nickname ? `Est. ${t.f.founded}` : `Franchise name <em>to be decided</em> · Est. ${t.f.founded}`}</div>
    <div class="hero-stats">
      <div><span class="big">${rec(t)}</span><span class="lbl">Record</span></div>
      <div><span class="big">${ord(t.divRank)}</span><span class="lbl">${esc(d.name)}</span></div>
      <div><span class="big">${ord(t.leagueRank)}</span><span class="lbl">League</span></div>
      <div><span class="big">${f1(t.pf)}</span><span class="lbl">Points for</span></div>
      <div><span class="big">${f1(t.pa)}</span><span class="lbl">Points against</span></div>
      <div><span class="big">${esc(t.streak)}</span><span class="lbl">Streak</span></div>
    </div>
  </div>
  <div class="next-up">
    <div class="gm-card">
      <img class="shot portrait" src="${gm.portrait ? esc(gm.portrait) : SIL}" alt="">
      <div><strong>${esc(gm.name || 'Open seat')}</strong><span><b>GM</b> · ${gm.since ? `since ${gm.since}` : 'awaiting a GM'}</span></div>
    </div>
    ${now && now.opp ? `<a class="gm-card" href="matchup.html#w${now.week}-t${t.id}">
      ${markSVG(now.opp.f, 'mark portrait')}
      <div><strong>${esc(now.opp.f.location)}</strong><span><b>Week ${now.week}</b> · vs · ${rec(now.opp)}</span></div>
    </a>` : ''}
  </div>
</div></section>`;
  }

  function weekStrip() {
    return `<nav class="weeks" aria-label="Weeks"><div class="wrap">${T.games.map(g => `
  <a class="wk${g.live ? ' now' : ''}" href="matchup.html#w${g.week}-t${T.id}" title="Week ${g.week} vs ${esc(g.opp ? g.opp.f.location : 'TBD')}">
    W${g.week} <span class="vs">vs</span> ${g.opp ? markSVG(g.opp.f, 'mini') : ''}${g.result ? `<span class="r ${g.result}">${g.result}</span>` : ''}
  </a>`).join('')}</div></nav>`;
  }

  const tabRow = cur => `<div class="tabs"><div class="wrap" role="tablist">${TABS.map(([id, label]) =>
    `<a class="tab" role="tab" href="#${id}" aria-selected="${id === cur}">${label}</a>`).join('')}</div></div>`;

  /* ---------- Tabs ---------- */
  function overview() {
    const t = T, sp = seasonPoints();
    const done = t.games.filter(g => g.final);
    const now = t.games.find(g => g.live);
    const top = Object.entries(sp).sort((a, b) => b[1].pts - a[1].pts).slice(0, 5);
    const hurt = t.roster.players.filter(id => P(id).injury_status);
    const divTeams = Object.values(M.teams).filter(x => x.division === t.division).sort((a, b) => a.divRank - b.divRank);
    const groups = POS_ORDER.map(pos => {
      const ids = t.roster.players.filter(id => P(id).position === pos);
      const ages = ids.map(id => P(id).age).filter(Boolean);
      return { pos, n: ids.length, age: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0 };
    }).filter(g => g.n);
    const maxN = Math.max(...groups.map(g => g.n), 1);
    const myTx = M.transactions.filter(x => x.roster_ids.includes(t.id)).slice(0, 3);

    return `<div class="grid">
  <section class="panel s8">
    <header><div><span class="eyebrow">This week</span><h2>Week ${M.current} matchup</h2></div>${now && now.opp ? `<a class="aside" href="matchup.html#w${now.week}-t${t.id}">Full matchup</a>` : '<span class="aside">Bye</span>'}</header>
    ${now && now.opp ? duel(t, now.opp) : '<div class="empty">No matchup this week.</div>'}
    <div class="sub">Season so far</div>
    <div class="statline">
      <div><span class="big">${rec(t)}</span><span class="lbl">Record</span></div>
      <div><span class="big">${t.divRecord[0]}-${t.divRecord[1]}</span><span class="lbl">Division</span></div>
      <div><span class="big">${done.length ? f1(t.pf / done.length) : '0.0'}</span><span class="lbl">Avg score</span></div>
      <div><span class="big">${f1(t.high)}</span><span class="lbl">High</span></div>
      <div><span class="big">${f1(t.low)}</span><span class="lbl">Low</span></div>
      <div><span class="big">${f1(t.pf - t.pa)}</span><span class="lbl">Point diff</span></div>
    </div>
  </section>
  <section class="panel s4">
    <header><div><span class="eyebrow">Injury report</span><h2>Availability</h2></div></header>
    ${hurt.length ? `<div class="plist">${hurt.map(id => { const p = P(id); return `
      <div class="prow"${UI.pid(id)}>${shot(id)}<div><div class="pname">${esc(p.full_name)} <small>${esc(p.position)} · ${esc(p.team || 'FA')}</small></div>
      <div class="pmeta">${esc(p.injury_body_part || 'Injury')}${t.roster.reserve.includes(id) ? ' · on IR slot' : ''}</div></div>${status(p)}</div>`; }).join('')}</div>`
      : '<div class="empty">Full strength. No one on the injury report.</div>'}
  </section>
  <section class="panel s8">
    <header><div><span class="eyebrow">${M.hub ? 'This season, League scoring' : 'As starters'}</span><h2>Top performers</h2></div><span class="aside">${M.hub ? 'All NFL games' : `Weeks 1-${done.length}`}</span></header>
    ${top.length ? '' : '<div class="empty">No starter points recorded yet.</div>'}<div class="cards">${top.map(([id, v]) => { const p = P(id); return `
      <div class="pcard"${UI.pid(id)}><span class="num">${p.number != null ? '#' + esc(p.number) : ''}</span><span class="pos ${esc(p.position)}">${esc(p.position)}</span>
        ${shot(id)}<div class="pname">${esc(p.full_name)}</div><div class="pmeta">${esc(p.team || 'FA')}</div>
        <div class="statline"><div><span class="big">${f1(v.pts)}</span><span class="lbl">Pts</span></div><div><span class="big">${f1(v.pts / v.gp)}</span><span class="lbl">Per gm</span></div></div>
      </div>`; }).join('')}</div>
  </section>
  <section class="panel s4">
    <header><div><span class="eyebrow">Standings</span><h2>${esc(t.division.name)}</h2></div><a class="aside" href="standings.html">Full standings</a></header>
    <div class="plist">${divTeams.map(x => `
      <a class="prow" href="team.html?team=${x.id}" style="${x.id === t.id ? 'border-color: var(--accent)' : ''}">${markSVG(x.f, 'shot')}
        <div><div class="pname">${esc(x.f.location)}</div><div class="pmeta">${f1(x.pf)} PF · ${esc(x.streak)}</div></div>
        <div class="pts">${rec(x)}<small>${ord(x.divRank)}</small></div></a>`).join('')}</div>
  </section>
  <section class="panel s6">
    <header><div><span class="eyebrow">Front office</span><h2>Recent moves</h2></div><a class="aside" href="#transactions">All moves</a></header>
    ${myTx.length ? myTx.map(txRow).join('') : '<div class="empty">No moves yet.</div>'}
  </section>
  <section class="panel s6">
    <header><div><span class="eyebrow">Dynasty outlook</span><h2>Roster build</h2></div><span class="aside">${t.roster.players.length} player${t.roster.players.length === 1 ? '' : 's'}</span></header>
    <div class="bars">${groups.map(g => `
      <div class="bar"><span class="pos ${g.pos}">${g.pos}</span><div class="track"><div class="fill" style="width:${(g.n / maxN) * 100}%"></div></div><span class="v">${g.n} · ${g.age ? f1(g.age) + ' yrs' : '-'}</span></div>`).join('')}
    </div>
    <div class="sub">Average age by position, from Sleeper's player data</div>
  </section>
</div>`;
  }

  function duel(a, b) {
    return `<div class="duel" style="--l:${wash(a.f)};--r:${wash(b.f)}">
  <div class="side">${UI.matchupLogo(a.f, 'mark', markSVG)}<div><div class="name">${esc(a.f.location)}</div><div class="rec">${rec(a)} · ${ord(a.divRank)} ${esc(a.division.name)}</div></div></div>
  <div class="mid"><div class="at">VS</div></div>
  <div class="side r">${UI.matchupLogo(b.f, 'mark', markSVG)}<div><div class="name">${esc(b.f.location)}</div><div class="rec">${rec(b)} · ${ord(b.divRank)} ${esc(b.division.name)}</div></div></div>
</div>`;
  }

  /* Hub rosters: every lineup spot on the field (defense above the line, offense below; flex spots and the kicker
     under it), empty ones too. The team's GM and the commissioner can tap a spot to fill it, or a player to move him
     (js/lineup.js does the editing; it sets window.LineupEdit once it knows who's signed in). */
  function hubDepth() {
    const t = T, r = t.roster, sp = seasonPoints(), slots = M.slots, ed = window.LineupEdit && LineupEdit.can(t.id);
    const st = slots.map((_, i) => (r.starters[i] && r.starters[i] !== '0' ? r.starters[i] : null));
    const gi = window.LineupEdit ? LineupEdit.game : () => null;
    const lp = window.LineupEdit && LineupEdit.pts ? LineupEdit.pts : () => null;
    const score = id => { const x = lp(id); return x ? `<div class="lu-pts"${x.line ? ` title="${esc(x.line)}"` : ''}><b>${f1(x.pts)}</b><small>Wk ${esc(x.week)}</small></div>` : ''; };
    const area = (slot, i) => {
      if (slot === 'IDP_FLEX') { const g = st[i] ? P(st[i]).position : 'LB'; return { DL: 'dl2', LB: 'lb2', DB: 'db2' }[g] || 'lb2'; }
      const n = slots.slice(0, i).filter(x => x === slot).length;
      return ({ QB: ['qb'], RB: ['rb1', 'rb2'], WR: ['wr1', 'wr2'], TE: ['te'], DL: ['dl1'], LB: ['lb1'], DB: ['db1'] }[slot] || [])[n] || null;
    };
    const game = id => { const g = gi(id); return g ? `<span class="lu-game${g.locked ? ' locked' : ''}">${g.locked ? '🔒 ' : ''}${esc(g.text)}</span>` : ''; };
    const spot = (slot, i, cls) => {
      const id = st[i], lab = UI.SLOT_SHORT[slot] || slot, tag = ed ? 'button type="button"' : 'div';
      if (!id) return `<${tag} class="${cls} lu-empty" data-lslot="${i}"${cls === 'slot' && area(slot, i) ? ` style="grid-area:${area(slot, i)}"` : ''}><span class="lu-plus">${ed ? '+' : ''}</span><div class="pmeta"><span class="pos ${esc(slot)}">${esc(lab)}</span> ${ed ? 'Tap to fill' : 'Empty'}</div></${tag.split(' ')[0]}>`;
      const p = P(id);
      return `<${tag} class="${cls}" data-lslot="${i}"${cls === 'slot' && area(slot, i) ? ` style="grid-area:${area(slot, i)}"` : ''}${ed ? '' : UI.pid(id)}>${shot(id)}<div class="pname">${esc(p.full_name)}</div>
        <div class="pmeta"><span class="pos ${esc(slot)}">${esc(lab)}</span> ${esc(p.team || 'FA')} ${status(p)}</div>${game(id)}${score(id)}</${tag.split(' ')[0]}>`;
    };
    const onField = slots.map((s, i) => (area(s, i) && !['FLEX', 'SUPER_FLEX', 'K'].includes(s) ? spot(s, i, 'slot') : '')).join('');
    const under = slots.map((s, i) => (['FLEX', 'SUPER_FLEX', 'K'].includes(s) ? spot(s, i, 'slot lu-flex') : '')).join('');
    const inLine = new Set(st.filter(Boolean));
    const bench = r.players.filter(id => !inLine.has(id) && !r.taxi.includes(id) && !r.reserve.includes(id));
    const bp = POS_ORDER.map(pos => [pos, bench.filter(id => P(id).position === pos)]).filter(x => x[1].length);
    const row = (id, where) => { const p = P(id); return `<div class="prow"${UI.pid(id)}>${shot(id)}<div><div class="pname">${esc(p.full_name)} ${status(p)}</div>
      <div class="pmeta"><span class="pos ${esc(p.position)}">${esc(p.position)}</span> ${esc(pmeta(p))} ${game(id)}${sp[id] ? ` · ${f1(sp[id].pts)} season` : ''}</div></div>
      ${(x => `<div class="pts"${x && x.line ? ` title="${esc(x.line)}"` : ''}>${x ? f1(x.pts) : '-'}<small>${x ? `Wk ${esc(x.week)}` : 'Pts'}</small></div>`)(lp(id))}${ed ? `<button class="btn lu-move" type="button" data-lmove="${esc(id)}" data-where="${where}">${where === 'bench' ? 'Move' : 'Activate'}</button>` : ''}</div>`; };
    const active = r.players.length - r.taxi.length - r.reserve.length, empty = st.filter(x => !x).length;
    return `<div class="grid">
  <section class="panel s12">
    <header><div><span class="eyebrow">Week ${M.current} lineup${ed ? ' · tap a spot to change it' : ''}</span><h2>Starters</h2></div>
      <span class="aside">${ed ? `${empty ? `<button class="btn primary" type="button" data-lfill="1">Fill ${empty} empty spot${empty > 1 ? 's' : ''}</button> ` : ''}` : ''}${empty ? `${empty} empty` : 'Full lineup'}</span></header>
    <div class="field two-way lu-field"><div class="formation"><div class="los" aria-hidden="true"><span>Defense</span><span>Line of scrimmage</span><span>Offense</span></div>${onField}</div></div>
    <div class="sub">Flex spots and kicker</div><div class="flexrow lu-under">${under}</div>
    <p class="footnote">Each player locks when his game kicks off (rule 7-4-2). ${ed ? 'Your lineup stays set from week to week until you change it.' : ''}</p>
  </section>
  <section class="panel s8">
    <header><div><span class="eyebrow">Depth · ${active} of 24 active</span><h2>Bench</h2></div><span class="aside">${bench.length} players · latest week's points</span></header>
    ${bp.length ? bp.map(([pos, ids]) => `<div class="sub"><span class="pos ${pos}">${pos}</span></div><div class="plist">${ids.map(id => row(id, 'bench')).join('')}</div>`).join('') : '<div class="empty">No one on the bench.</div>'}
  </section>
  <section class="panel s4">
    <header><div><span class="eyebrow">Rookies only · 5 spots</span><h2>Taxi squad</h2></div><span class="aside">${r.taxi.length}/5</span></header>
    ${r.taxi.length ? `<div class="plist">${r.taxi.map(id => row(id, 'taxi')).join('')}</div>` : '<div class="empty">Taxi squad is empty.</div>'}
    <div class="sub">Injured reserve · ${r.reserve.length}/4</div>
    ${r.reserve.length ? `<div class="plist">${r.reserve.map(id => row(id, 'ir')).join('')}</div>` : '<div class="empty">No one on IR.</div>'}
  </section>
</div>`;
  }

  function depthChart() {
    if (M.hub) return hubDepth();
    const t = T, r = t.roster, sp = seasonPoints();
    // Offense below the line of scrimmage, defense above it. Offensive flex spots and the kicker sit under the
    // field; the IDP flex takes the open spot in its own position group.
    const areas = { QB: ['qb'], RB: ['rb1', 'rb2'], WR: ['wr1', 'wr2', 'wr3'], TE: ['te'], DL: ['dl1', 'dl2'], LB: ['lb1', 'lb2'], DB: ['db1', 'db2'] };
    const used = Object.fromEntries(Object.keys(areas).map(k => [k, 0]));
    const onField = [], flex = [];
    M.slots.forEach((slot, i) => {
      const id = r.starters[i];
      if (!id || id === '0') return;
      const g = slot === 'IDP_FLEX' ? P(id).position : slot;
      const a = areas[g] && areas[g][used[g]];
      if (a) { used[g]++; onField.push({ id, slot, area: a }); } else flex.push({ id, slot });
    });
    const twoWay = onField.some(s => /^(dl|lb|db)/.test(s.area));
    const bench = r.players.filter(id => !r.starters.includes(id) && !r.taxi.includes(id) && !r.reserve.includes(id));
    const bp = POS_ORDER.map(pos => [pos, bench.filter(id => P(id).position === pos)]).filter(x => x[1].length);
    const row = (id, label) => { const p = P(id); return `<div class="prow"${UI.pid(id)}>${shot(id)}<div><div class="pname">${esc(p.full_name)} ${status(p)}</div>
      <div class="pmeta"><span class="pos ${esc(label || p.position)}">${esc(SLOT_LABEL[label] || label || p.position)}</span> ${esc(pmeta(p))}</div></div>
      <div class="pts">${sp[id] ? f1(sp[id].pts) : '-'}<small>Pts</small></div></div>`; };

    return `<div class="grid">
  <section class="panel s12">
    <header><div><span class="eyebrow">Week ${M.current} lineup</span><h2>Starters</h2></div><span class="aside">${M.live ? 'Live from Sleeper' : 'Sample lineup'}</span></header>
    <div class="field${twoWay ? ' two-way' : ''}"><div class="formation">${twoWay ? '<div class="los" aria-hidden="true"><span>Defense</span><span>Line of scrimmage</span><span>Offense</span></div>' : ''}${onField.map(s => { const p = P(s.id); return `
      <div class="slot" style="grid-area:${s.area}"${UI.pid(s.id)}>${shot(s.id)}<div class="pname">${esc(p.full_name)}</div>
        <div class="pmeta"><span class="pos ${esc(s.slot)}">${esc(UI.SLOT_SHORT[s.slot] || s.slot)}</span> ${esc(p.team || 'FA')} ${status(p)}</div></div>`; }).join('')}
    </div></div>
    ${flex.length ? `<div class="sub">Flex spots${flex.some(s => s.slot === 'K') ? ' and kicker' : ''}</div><div class="flexrow">${flex.map(s => row(s.id, s.slot)).join('')}</div>` : ''}
  </section>
  <section class="panel s8">
    <header><div><span class="eyebrow">Depth</span><h2>Bench</h2></div><span class="aside">${bench.length} players</span></header>
    ${bp.map(([pos, ids]) => `<div class="sub"><span class="pos ${pos}">${pos}</span></div><div class="plist">${ids.map(id => row(id)).join('')}</div>`).join('')}
  </section>
  <section class="panel s4">
    <header><div><span class="eyebrow">Stash</span><h2>Taxi squad</h2></div><span class="aside">${r.taxi.length}</span></header>
    ${r.taxi.length ? `<div class="plist">${r.taxi.map(id => row(id)).join('')}</div>` : '<div class="empty">Taxi squad is empty.</div>'}
    <div class="sub">Injured reserve</div>
    ${r.reserve.length ? `<div class="plist">${r.reserve.map(id => row(id)).join('')}</div>` : '<div class="empty">No one on IR.</div>'}
  </section>
</div>`;
  }

  function roster() {
    const r = T.roster, sp = seasonPoints();
    const role = id => r.starters.includes(id) ? '<span class="tag ok">Starter</span>' : r.taxi.includes(id) ? '<span class="tag taxi">Taxi</span>'
      : r.reserve.includes(id) ? '<span class="tag ir">IR</span>' : '<span class="tag taxi">Bench</span>';
    const rows = POS_ORDER.map(pos => {
      const ids = r.players.filter(id => P(id).position === pos).sort((a, b) => (sp[b] ? sp[b].pts : 0) - (sp[a] ? sp[a].pts : 0));
      if (!ids.length) return '';
      return `<tr class="group"><td colspan="9">${pos} · ${ids.length}</td></tr>` + ids.map(id => { const p = P(id); return `<tr>
        <td><div class="cellp"${UI.pid(id)}>${shot(id)}<span class="pname">${esc(p.full_name)}</span></div></td>
        <td><span class="pos ${esc(p.position)}">${esc(p.position)}</span></td><td>${esc(p.team || 'FA')}</td>
        <td class="num">${p.age || '-'}</td><td class="num">${p.years_exp != null ? p.years_exp : '-'}</td>
        <td>${esc(height(p.height))}${p.weight ? ' · ' + esc(p.weight) : ''}</td><td>${esc(p.college || '')}</td>
        <td>${role(id)} ${status(p)}</td><td class="num">${sp[id] ? f1(sp[id].pts) : '-'}</td></tr>`; }).join('');
    }).join('');
    return `<section class="panel">
  <header><div><span class="eyebrow">${r.players.length} players</span><h2>Full roster</h2></div><span class="aside">Player info from Sleeper</span></header>
  <div class="tablewrap"><table><thead><tr><th>Player</th><th>Pos</th><th>NFL</th><th class="num">Age</th><th class="num">Exp</th><th>Ht · Wt</th><th>College</th><th>Status</th><th class="num">Pts</th></tr></thead>
  <tbody>${rows}</tbody></table></div>
</section>`;
  }

  function schedule() {
    return `<section class="panel">
  <header><div><span class="eyebrow">${M.league.regularSeasonWeeks} weeks</span><h2>${esc(M.state.season)} schedule</h2></div><span class="aside">${rec(T)}</span></header>
  <div class="sched">${T.games.map(g => `
    <a class="srow${g.live ? ' now' : ''}" href="matchup.html#w${g.week}-t${T.id}"><span class="w">W${g.week}</span>
      <div class="opp">${g.opp ? markSVG(g.opp.f) : ''}<div><div class="pname">${g.opp ? esc(g.opp.f.location) : 'TBD'}</div><div class="pmeta">${g.opp ? `${rec(g.opp)} · ${esc(g.opp.division.name)}` : ''}</div></div></div>
      <span class="res ${g.result || ''}">${g.result || (g.live ? '<span class="tag trade">Now</span>' : '')}</span>
      <span class="score">${g.final ? `${f2(g.me.points)} - ${f2(g.oppRow.points)}` : g.started ? 'In progress' : 'Upcoming'}</span>
    </a>`).join('')}</div>
</section>`;
  }

  function draftCapital() {
    const me = T.id, L = M.league, first = +M.state.season + 1;
    const seasons = Array.from({ length: L.futurePickSeasons }, (_, i) => String(first + i));
    const tp = M.tradedPicks;
    const name = rid => M.teams[rid] ? M.teams[rid].f.location : `Team ${rid}`;
    let total = 0, firsts = 0, got = 0, gone = 0;
    const cells = seasons.map(season => {
      const tds = Array.from({ length: L.draftRounds }, (_, i) => {
        const round = i + 1, out = [];
        const own = tp.find(p => p.season === season && p.round === round && p.roster_id === me);
        if (own && own.owner_id !== me) { gone++; out.push(`<div class="pick gone"><span class="rd">R${round}</span><span class="via">to ${esc(name(own.owner_id))}</span></div>`); }
        else { total++; if (round === 1) firsts++; out.push(`<div class="pick"><span class="rd">R${round}</span><span class="via">Own</span></div>`); }
        tp.filter(p => p.season === season && p.round === round && p.owner_id === me && p.roster_id !== me).forEach(p => {
          total++; got++; if (round === 1) firsts++;
          out.push(`<div class="pick extra"><span class="rd">R${round}</span><span class="via">via ${esc(name(p.roster_id))}</span></div>`);
        });
        return `<div style="display:grid;gap:6px">${out.join('')}</div>`;
      }).join('');
      return `<div class="yr">${season}</div>${tds}`;
    }).join('');
    return `<div class="grid">
  <section class="panel s12">
    <header><div><span class="eyebrow">Next ${L.futurePickSeasons} drafts</span><h2>Draft capital</h2></div><span class="aside">${L.draftRounds} rounds</span></header>
    <div class="statline" style="margin-bottom:14px">
      <div><span class="big">${total}</span><span class="lbl">Picks owned</span></div>
      <div><span class="big">${firsts}</span><span class="lbl">First-rounders</span></div>
      <div><span class="big">${got}</span><span class="lbl">Acquired</span></div>
      <div><span class="big">${gone}</span><span class="lbl">Traded away</span></div>
    </div>
    <div class="picks" style="--rounds:${L.draftRounds}"><div></div>${Array.from({ length: L.draftRounds }, (_, i) => `<div class="hd">Round ${i + 1}</div>`).join('')}${cells}</div>
  </section>
</div>`;
  }

  function txRow(x) {
    const me = T.id, other = x.roster_ids.find(r => r !== me);
    const d = new Date(x.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const label = { trade: 'Trade', waiver: 'Waiver', free_agent: 'Free agent', commissioner: 'Commissioner' }[x.type] || x.type;
    const name = rid => M.teams[rid] ? M.teams[rid].f.location : `Team ${rid}`;
    const adds = Object.entries(x.adds || {}).filter(([, r]) => r === me).map(([id]) => id);
    const drops = Object.entries(x.drops || {}).filter(([, r]) => r === me).map(([id]) => id);
    const pin = (x.draft_picks || []).filter(p => p.owner_id === me), pout = (x.draft_picks || []).filter(p => p.previous_owner_id === me);
    const pk = p => `${p.season} round ${p.round}${p.roster_id !== me ? ` (${esc(name(p.roster_id))})` : ''}`;
    const mv = (cls, sign, html) => `<div class="mv"><span class="sign ${cls}">${sign}</span>${html}</div>`;
    const pl = id => { const p = P(id); return `<span class="pname"${UI.pid(id)}>${esc(p.full_name)}</span> <span class="pos ${esc(p.position)}">${esc(p.position)}</span> <span class="pmeta">${esc(p.team || 'FA')}</span>`; };
    return `<div class="tx"><div class="when"><span class="tag ${esc(x.type)}">${esc(label)}</span><span>${esc(d)} · W${x.leg}</span>
      ${x.type === 'trade' && other ? `<span>with ${esc(name(other))}</span>` : ''}${x.settings && x.settings.waiver_bid != null ? `<span>$${x.settings.waiver_bid} bid</span>` : ''}</div>
    <div class="moves">${x.settings && x.settings.note ? `<div class="mv"><span class="pname">${esc(x.settings.note)}</span></div>` : ''}${adds.map(id => mv('add', '+', pl(id))).join('')}${pin.map(p => mv('add', '+', `<span class="pname">${pk(p)} pick</span>`)).join('')}
      ${drops.map(id => mv('drop', '−', pl(id))).join('')}${pout.map(p => mv('drop', '−', `<span class="pname">${pk(p)} pick</span>`)).join('')}</div></div>`;
  }

  function transactions() {
    const list = M.transactions.filter(x => x.roster_ids.includes(T.id));
    return `<section class="panel"><header><div><span class="eyebrow">${list.length} moves</span><h2>Transactions</h2></div><span class="aside">${esc(M.state.season)} season</span></header>
  ${list.length ? list.map(txRow).join('') : '<div class="empty">No moves yet.</div>'}</section>`;
  }

  function history() {
    const t = T, gm = t.f.gm || {};
    const lineage = [...(t.f.pastGms || []), ...(gm.name ? [{ name: gm.name, from: gm.since, to: null, record: rec(t), current: true }] : [])];
    const past = M.history.filter(s => s.teams && s.teams[t.id]).map(s => ({ s, e: s.teams[t.id] }));
    const post = s => s.champion === t.id ? '<span class="tag ok">Champion</span>' : s.runnerUp === t.id ? '<span class="tag trade">Runner-up</span>' : '-';
    const divName = id => (M.league.divisions.find(d => d.id === id) || t.division).name;
    return `<div class="grid" id="history" style="margin-top:12px">
  <section class="panel s8">
    <header><div><span class="eyebrow">Franchise history · est. ${t.f.founded}</span><h2>Season by season</h2></div></header>
    ${honorsRack(t.titles, t.divTitles)}
    <div class="tablewrap"><table><thead><tr><th>Season</th><th>GM</th><th class="num">W-L</th><th class="num">PF</th><th class="num">PA</th><th>Division</th><th>Postseason</th></tr></thead>
    <tbody>${past.map(({ s, e }) => `<tr><td>${esc(s.season)}</td><td>${esc(e.gmName || '-')}</td><td class="num">${e.wins}-${e.losses}${e.ties ? '-' + e.ties : ''}</td><td class="num">${f1(e.pf)}</td><td class="num">${f1(e.pa)}</td>
      <td>${(s.divisionWinners || []).includes(t.id) ? '<span class="tag ok">Won</span> ' : ''}${esc(divName(e.division))}</td><td>${post(s)}</td></tr>`).join('')}
    ${M.history.some(s => s.season === M.state.season) ? '' : `<tr><td>${esc(M.state.season)}</td><td>${esc(gm.name || '-')}</td><td class="num">${rec(t)}</td><td class="num">${f1(t.pf)}</td><td class="num">${f1(t.pa)}</td><td>${ord(t.divRank)} in ${esc(t.division.name)} <span class="tag taxi">In progress</span></td><td>-</td></tr>`}</tbody></table></div>
    ${past.length ? '' : `<div class="sub">Inaugural season</div>
    <div class="empty">This franchise's first season is still being played. Finished seasons, titles and records will be added here as they're completed.</div>`}
  </section>
  <section class="panel s4">
    <header><div><h2>GM lineage</h2></div></header>
    ${lineage.length ? `<div class="plist">${lineage.map(g => `
      <div class="prow"><img class="shot" src="${SIL}" alt=""><div><div class="pname">${esc(g.name)} ${g.current ? '<span class="tag ok">Current</span>' : ''}</div>
      <div class="pmeta">${g.from || '?'}-${g.to || 'present'}</div></div><div class="pts">${esc(g.record || '-')}<small>Record</small></div></div>`).join('')}</div>`
      : '<div class="empty">No GM has held this franchise yet.</div>'}
  </section>
</div>`;
  }

  function frontOffice() {
    const t = T, gm = t.f.gm || {}, c = t.f.colors, logos = t.f.logos || {};
    const car = t.gmKey && M.careers[t.gmKey], rack = car ? honorsRack(car.titles, car.divs) : '';
    const st = t.f.logoStatus || {};
    const slot = (key, label, art) => `<div class="logo-slot">${art}<b>${label}</b><span>${logos[key] ? (st[key] || 'Final') : 'Awaiting designer'}</span></div>`;
    const img = (src, alt) => `<img class="mark logo-img" src="${esc(src)}" alt="${esc(alt)}">`;
    const palette = t.f.palette || [['Primary', c.primary], ['Secondary', c.secondary], ['Trim', c.trim]];
    const alts = Object.entries(logos.alternates || {});
    // Records follow the GM (history.json + this season): regular season, playoffs, the Blitz Bowl (titles vs. runner-ups),
    // and player awards won by the GM's players (each award's season and franchise must be one this GM ran).
    const runs = new Set(M.history.flatMap(sz => Object.entries(sz.teams || {}).filter(([, e]) => car && e.gm === car.key).map(([rid]) => `${sz.season}:${rid}`)));
    const tro = M.league.awardTrophies || {}, AW = { opoy: 'Offensive Player of the Year', dpoy: 'Defensive Player of the Year', roy: 'Rookie of the Year' };
    const won = {}; for (const list of Object.values(M.playerHonors || {})) for (const hh of list) if (runs.has(`${hh.season}:${hh.rid}`)) won[hh.award] = (won[hh.award] || 0) + 1;
    const records = car ? `<div class="statline fo-rec">
          <div><span class="big">${recOf(car)}</span><span class="lbl">Regular season</span></div>
          <div><span class="big">${car.poW}-${car.poL}</span><span class="lbl">Playoffs</span></div>
          <div><span class="big">${car.titles.length}-${car.runnerUps.length}</span><span class="lbl">Blitz Bowl</span></div>
        </div>
        <div class="fo-awards">${Object.keys(AW).filter(k => tro[k]).map(k => `<div class="fo-award${won[k] ? '' : ' none'}" title="${esc(AW[k])}"><img src="${esc(tro[k])}" alt=""><b>×${won[k] || 0}</b><span>${esc(AW[k].replace(' of the Year', '').replace('Player', 'POY'))}</span></div>`).join('')}</div>` : '';
    return `<div class="grid">
  <div class="s7 fo-col">
  <section class="panel">
    <header><div><span class="eyebrow">General manager</span><h2>${esc(gm.name || 'Open seat')}</h2></div><span class="aside">${gm.since ? `Since ${gm.since}` : ''}</span></header>
    <div class="fo${rack ? '' : ' bare'}">
      ${gm.portrait ? `<img class="portrait-lg" src="${esc(gm.portrait)}" alt="${esc(gm.name)}">` : '<div class="portrait-lg">Portrait coming</div>'}
      ${rack}
      <div>
        <div class="statline" style="margin-bottom:6px">
          <div><span class="big">${car ? f1(car.pf) : '-'}</span><span class="lbl">Points for</span></div>
          <div><span class="big">${car ? f1(car.pa) : '-'}</span><span class="lbl">Points against</span></div>
          <div><a class="big" href="#earnings">${car ? UI.money(car.won) : '-'}</a><span class="lbl">Career earnings</span></div>
        </div>
        ${records}
        <div class="pmeta">${car ? `Career as a Blitz League GM: ${car.seasons} season${car.seasons === 1 ? '' : 's'}${car.teams.size > 1 ? ` with ${car.teams.size} franchises` : ''}${car.current ? `, ${esc(M.state.season)} so far` : ''}. Records, titles and awards follow the GM.` : 'No GM has claimed this franchise yet.'}</div>
      </div>
    </div>
  </section>
  ${earnings()}
  </div>
  <section class="panel s5">
    <header><div><span class="eyebrow">Brand kit</span><h2>Identity</h2></div></header>
    <div class="swatches">${palette.map(([n, h]) =>
      `<div class="sw"><i style="background:${esc(h)}"></i><b>${n}</b>${esc(h)}</div>`).join('')}</div>
    <div class="sub">Logos</div>
    <div class="logo-slots">
      ${slot('primary', 'Primary logo', logos.primary ? img(logos.primary, 'Primary logo') : markSVG(t.f))}
      ${slot('mark', 'Secondary mark', logos.mark ? img(logos.mark, 'Secondary mark') : markSVG(t.f))}
      ${slot('wordmark', 'Wordmark', logos.wordmark ? img(logos.wordmark, 'Wordmark') : `<span class="big" style="font-size:22px">${esc(t.f.location.toUpperCase())}</span>`)}
      ${slot('helmetDecal', 'Helmet decal', helmetHTML(t.f))}
      ${alts.map(([n, src]) => `<div class="logo-slot">${img(src, n)}<b>${esc(n)}</b><span>${esc(st.alternates || 'Final')}</span></div>`).join('')}
    </div>
    ${t.f.helmetImages && t.f.helmetImages.alternate
      ? `<div class="sub">Helmet, primary and alternate</div>
    <div class="helmet-pair">${helmetHTML(t.f, { facing: 'right', variant: 'home' })}${helmetHTML(t.f, { facing: 'left', variant: 'alternate' })}</div>`
      : `<div class="sub">Helmet, home and away</div>
    <div class="helmet-pair">${helmetHTML(t.f, { facing: 'right', variant: 'home' })}${helmetHTML(t.f, { facing: 'left', variant: 'away' })}</div>`}
    ${t.f.uniforms ? `<div class="sub">Uniforms</div><div class="uniforms">${Object.entries(t.f.uniforms).map(([n, src]) =>
      `<figure><img src="${esc(src)}" alt="${esc(n)} uniform" loading="lazy"><figcaption>${esc(n)}</figcaption></figure>`).join('')}</div>` : ''}
  </section>
</div>${history()}`;
  }

  // Career earnings: every prize the current GM has won, with any franchise, at the amounts paid that season.
  function earnings() {
    const t = T, gm = t.f.gm || {}, car = t.gmKey && M.careers[t.gmKey];
    if (!car) return '';
    const money = UI.money, cash = UI.cash, L = UI.PRIZE_LABEL, E = car.earnings;
    const seasons = gmSeasons(car), buyIns = seasons.reduce((n, s) => n + s.buyIn, 0), net = car.won - buyIns;
    const franchise = rid => (M.teams[rid] ? M.teams[rid].f.location : `Team ${rid}`);
    const kinds = Object.keys(L).map(k => ({ k, list: E.filter(e => e.kind === k) })).filter(x => x.list.length);
    const summary = list => Object.keys(L).map(k => { const x = list.filter(e => e.kind === k); if (!x.length) return '';
      return k === 'weekly' ? `${x.length} weekly high score${x.length === 1 ? '' : 's'}` : L[k]; }).filter(Boolean).join(' · ');
    const sign = n => `<span class="${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}</span>`;
    const inMoney = seasons.filter(s => E.some(e => e.season === s.season)).length;
    return `<div class="fo-earn" id="earnings">
  <section class="panel">
    <header><div><span class="eyebrow">${esc(gm.name || car.name || 'General manager')} · follows the GM</span><h2>Career earnings</h2></div><span class="aside">${seasons.length} season${seasons.length === 1 ? '' : 's'}</span></header>
    <div class="statline">
      <div><span class="big gold">${money(car.won)}</span><span class="lbl">Won</span></div>
      <div><span class="big">${money(buyIns)}</span><span class="lbl">Buy-ins paid</span></div>
      <div><span class="big">${sign(net)}</span><span class="lbl">Net</span></div>
      <div><span class="big">${E.filter(e => e.kind === 'weekly').length}</span><span class="lbl">Weekly high scores</span></div>
      <div><span class="big">${inMoney}</span><span class="lbl">Seasons in the money</span></div>
    </div>
  </section>
  <section class="panel">
    <header><div><span class="eyebrow">What paid</span><h2>By prize</h2></div></header>
    ${kinds.length ? `<div class="tablewrap"><table class="st"><thead><tr><th>Prize</th><th class="num">Times</th><th class="num">Won</th></tr></thead>
      <tbody>${kinds.map(({ k, list }) => `<tr><td>${esc(L[k])}</td><td class="num">${list.length}</td><td class="num">${cash(list.reduce((n, e) => n + e.amount, 0))}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nothing won yet. The first weekly prize goes out once week 1 is final.</div>'}
  </section>
  <section class="panel">
    <header><div><span class="eyebrow">Year by year</span><h2>By season</h2></div></header>
    <div class="tablewrap"><table class="st"><thead><tr><th>Season</th><th class="hide-sm">Prizes</th><th class="num">Won</th><th class="num">Net</th></tr></thead>
      <tbody>${seasons.slice().reverse().map(s => { const list = E.filter(e => e.season === s.season), won = list.reduce((n, e) => n + e.amount, 0);
        return `<tr><td class="strong">${esc(s.season)}${s.current ? ' <span class="tag taxi">So far</span>' : ''}<div class="pmeta">${esc(franchise(s.rid))}</div>${list.length ? `<div class="pmeta show-sm">${summary(list)}</div>` : ''}</td>
          <td class="pmeta hide-sm">${list.length ? summary(list) : '-'}</td><td class="num">${won ? cash(won) : '-'}</td><td class="num">${sign(won - s.buyIn)}</td></tr>`; }).join('')}</tbody></table></div>
  </section>
  <p class="footnote">Earnings follow the GM between franchises. Each season counts at the prize amounts in force that year. ${car.current ? `${esc(M.state.season)} so far includes only the weekly prizes already won; the division, points-leader, playoff and GM of the Year money is added once it's decided.` : ''}</p>
</div>`;
  }

  // Trades (Hub rosters only): js/trades.js fills this in for signed-in GMs.
  function trades() {
    if (!M.hub) return '<section class="panel"><div class="empty">Trades open once the league runs on the Hub\'s own rosters.</div></section>';
    return `<div id="trades-ui" data-team="${T.id}"><section class="panel"><div class="empty">Sign in on the <a href="account.html">Account</a> page to make and answer trade offers.</div></section></div>`;
  }

  const RENDER = { trades, overview, 'depth-chart': depthChart, roster, schedule, 'draft-capital': draftCapital, transactions, 'front-office': frontOffice };

  function route() {
    const h = location.hash.slice(1), tab = h === 'history' || h === 'earnings' ? 'front-office' : RENDER[h] ? h : 'overview';
    document.getElementById('tabs').innerHTML = tabRow(tab);
    document.getElementById('content').innerHTML = RENDER[tab]();
    document.title = `${teamName(T)} · Blitz Hub`;
    paintHelmets(document).catch(e => console.error(e));
    // #history (old links) = the history section at the foot of Front Office. Logos above it load late and push it
    // down, so land on it again once they have.
    if (h === 'history' || h === 'earnings') { const go = () => { const el = document.getElementById(h); if (el && location.hash === '#' + h) el.scrollIntoView(); };
      requestAnimationFrame(go); if (document.readyState !== 'complete') addEventListener('load', go, { once: true }); else setTimeout(go, 400); }
  }

  const applyColors = f => UI.applyColors(f);

  async function start() {
    const content = document.getElementById('content');
    try {
      M = await Hub.load();
      const want = +(new URLSearchParams(location.search).get('team') || document.body.dataset.team || 1);
      T = M.teams[want] || M.teams[1];
      applyColors(T.f);
      document.getElementById('sample-flag').hidden = M.live;
      UI.myTeam(M);
      document.getElementById('season').innerHTML = `<strong>${esc(M.state.season)} season</strong><span>Week ${M.current}</span>`;
      document.getElementById('crumb').innerHTML = `<a href="teams.html">Teams</a> · ${esc(T.division.name)} · <strong>${esc(teamName(T))}</strong>`;
      document.getElementById('hero').innerHTML = hero() + weekStrip();
      route();
      addEventListener('hashchange', route);
      window.TeamPage = { M, T, P, route };
      addEventListener('hub:lineup', () => { if (location.hash.slice(1) === 'depth-chart') route(); });
      addEventListener('hub:moves', () => route());   // an add or drop changed a roster   // js/ui.js keeps the tab bar and scroll position sensible
      addEventListener('hub:injuries', () => { const h = location.hash.slice(1); if (!RENDER[h] || h === 'overview') route(); });
    } catch (e) {
      content.innerHTML = `<div class="error">Couldn't load league data. ${esc(e.message)}</div>`;
      console.error(e);
    }
  }
  start();
})();
