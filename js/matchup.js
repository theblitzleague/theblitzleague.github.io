/* Matchup page: two franchises head to head for one week.
   Route: #w<week>-t<roster_id>  (that team on the left). Defaults to roster 1, current week.
   Plain #name hashes only, so links survive inside the preview viewer too. */
(function () {
  const { esc, f1, f2, ord, SLOT_SHORT, shot, teamName, rec, status, wash, accentFor, primaryLogo } = UI;
  let M;
  const P = id => M.players[id] || { full_name: `Player ${id}`, position: '?' };

  function parseRoute() {
    const m = /^#w(\d+)-t(\d+)$/.exec(location.hash);
    const team = m ? +m[2] : +(document.body.dataset.team || 1);
    const week = m ? +m[1] : M.current;
    return { team: M.teams[team] ? team : 1, week };
  }
  const link = (week, team) => `#w${week}-t${team}`;
  const state = g => (g.final ? 'final' : g.live ? 'live' : 'upcoming');
  const avg = t => { const n = t.games.filter(g => g.final).length; return n ? t.pf / n : 0; };

  /* ---------- Hero ---------- */
  function side(t, dir) {
    const gm = (t.f.gm && t.f.gm.name) || 'Open seat';
    return `<div class="mside ${dir}" style="--ink:${accentFor(t.f)}">
      ${UI.matchupLogo(t.f, 'mlogo', primaryLogo)}
      <div class="mid-id">
        <span class="eyebrow">${divMarkHTML(t.division)}${esc(t.division.name)}</span>
        <a class="mname" href="team.html?team=${t.id}">${esc(t.f.location)}${t.f.nickname ? `<small>${esc(t.f.nickname)}</small>` : ''}</a>
        <div class="mrec">${rec(t)} · ${ord(t.divRank)} in division · GM ${esc(gm)}</div>
      </div>
    </div>`;
  }

  function hero(L, R, g) {
    const st = state(g), a = g.me.points, b = g.oppRow.points;
    const share = st === 'upcoming' ? avg(L) / ((avg(L) + avg(R)) || 1) : a / ((a + b) || 1);
    const label = { final: 'Final', live: 'Live', upcoming: 'Upcoming' }[st];
    const scoreA = st === 'upcoming' ? f1(avg(L)) : f2(a), scoreB = st === 'upcoming' ? f1(avg(R)) : f2(b);
    const lead = st === 'upcoming' ? '' : a > b ? 'l' : b > a ? 'r' : '';
    return `<section class="mhero" style="--lw:${wash(L.f)};--rw:${wash(R.f)};--lc:${accentFor(L.f)};--rc:${accentFor(R.f)}">
  <div class="wrap mgrid">
    <div class="mh l">${helmetHTML(L.f, { facing: 'right', variant: 'home' })}</div>
    ${side(L, 'l')}
    <div class="mcenter">
      ${UI.billingHTML(M, g, { season: true })}
      <div class="mstatus ${st}">${label}${st === 'live' ? '<i></i>' : ''}</div>
      <div class="mscore"><span class="${lead === 'l' ? 'win' : ''}">${scoreA}</span><b>${st === 'upcoming' ? 'VS' : '-'}</b><span class="${lead === 'r' ? 'win' : ''}">${scoreB}</span></div>
      <div class="mshare"><div style="width:${(share * 100).toFixed(1)}%"></div></div>
      <div class="msharelbl"><span>${(share * 100).toFixed(0)}%</span><em>${st === 'upcoming' ? 'Season scoring average' : 'Share of points'}</em><span>${(100 - share * 100).toFixed(0)}%</span></div>
      ${UI.broadcastHTML(M)}
      ${UI.oddsHTML(M, g)}
      <a class="mswap" href="${link(g.week, R.id)}">Swap sides</a>
    </div>
    ${side(R, 'r')}
    <div class="mh r">${helmetHTML(R.f, { facing: 'left', variant: 'away' })}</div>
  </div>
</section>`;
  }

  const gamesOf = t => t.games.concat(t.playoffGames || []);
  function weekStrip(L, week) {
    return `<nav class="weeks" aria-label="Weeks"><div class="wrap">${gamesOf(L).map(g => `
  <a class="wk${g.week === week ? ' now' : ''}" href="${link(g.week, L.id)}" title="Week ${g.week} vs ${esc(g.opp ? g.opp.f.location : 'TBD')}">
    ${g.playoff ? 'P' : 'W'}${g.week} <span class="vs">vs</span> ${g.opp ? markSVG(g.opp.f, 'mini') : ''}${g.result ? `<span class="r ${g.result}">${g.result}</span>` : g.live ? '<span class="r live">Live</span>' : ''}
  </a>`).join('')}</div></nav>`;
  }

  /* ---------- Lineups ---------- */
  function cell(id, pts, st, dir, better) {
    if (!id || id === '0') return `<div class="lp ${dir} empty">Empty slot</div>`;
    const p = P(id);
    // Hub matchups know each starter's game state: "-" only until his game kicks off. (Sleeper preview: "-" while 0.)
    const shown = st === 'upcoming' || (M.liveScoring ? pts == null : st === 'live' && !pts) ? '<span class="dash">-</span>' : f2(pts || 0);
    return `<div class="lp ${dir}${better ? ' better' : ''}"${UI.pid(id)}>
      ${shot(id)}
      <div class="lpn"><div class="pname">${esc(p.full_name)} ${status(p)}</div><div class="pmeta">${esc(p.position)} · ${esc(p.team || 'FA')}</div></div>
      <div class="lpp">${shown}</div>
    </div>`;
  }

  function lineups(L, R, g) {
    const st = state(g), a = g.me, b = g.oppRow;
    const rows = M.slots.map((slot, i) => {
      const pa = (a.starters_points || [])[i], pb = (b.starters_points || [])[i];
      const show = st !== 'upcoming';
      return `<div class="lrow">${cell(a.starters[i], pa, st, 'l', show && pa > pb)}<span class="pos ${esc(slot)} slot">${esc(SLOT_SHORT[slot] || slot)}</span>${cell(b.starters[i], pb, st, 'r', show && pb > pa)}</div>`;
    }).join('');
    const bench = (row) => (row.players || []).filter(id => !row.starters.includes(id))
      .sort((x, y) => UI.POS_ORDER.indexOf(P(x).position) - UI.POS_ORDER.indexOf(P(y).position))
      .map(id => { const p = P(id); return `<li${UI.pid(id)}><span class="pos ${esc(p.position)}">${esc(p.position)}</span> ${esc(p.full_name)} <small>${esc(p.team || 'FA')}</small> ${status(p)}</li>`; }).join('');
    return `<section class="panel s12" style="--lc:${accentFor(L.f)};--rc:${accentFor(R.f)}">
    <header><div><span class="eyebrow">Head to head</span><h2>Starting lineups</h2></div><span class="aside">${st === 'live' ? `"-" = yet to play${M.liveScoring && M.liveAt ? ` · updated ${esc(new Date(M.liveAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}` : ''}` : st === 'upcoming' ? 'Projected from current lineups' : 'Final scoring'}</span></header>
    <div class="lhead"><span style="color:var(--lc)">${esc(L.f.location)}</span><span></span><span style="color:var(--rc)">${esc(R.f.location)}</span></div>
    <div class="lineup">${rows}
      <div class="lrow total"><div class="lp l"><div class="lpn"><div class="pname">Total</div></div><div class="lpp">${st === 'upcoming' ? '-' : f2(a.points)}</div></div><span></span><div class="lp r"><div class="lpn"><div class="pname">Total</div></div><div class="lpp">${st === 'upcoming' ? '-' : f2(b.points)}</div></div></div>
    </div>
    <div class="benches"><div><div class="sub">${esc(L.f.location)} bench</div><ul class="bench">${bench(a)}</ul></div><div><div class="sub">${esc(R.f.location)} bench</div><ul class="bench">${bench(b)}</ul></div></div>
  </section>`;
  }

  /* ---------- Tale of the tape + around the league ---------- */
  function tape(L, R) {
    const done = t => t.games.filter(g => g.final).length;
    const rows = [
      ['Record', rec(L), rec(R), L.wins - R.wins],
      ['Points for', f1(L.pf), f1(R.pf), L.pf - R.pf],
      ['Avg score', f1(avg(L)), f1(avg(R)), avg(L) - avg(R)],
      ['High score', f1(L.high), f1(R.high), L.high - R.high],
      ['Points against', f1(L.pa), f1(R.pa), R.pa - L.pa],
      ['League rank', ord(L.leagueRank), ord(R.leagueRank), R.leagueRank - L.leagueRank],
      ['Streak', L.streak, R.streak, 0],
    ];
    const h2h = L.games.filter(g => g.final && g.opp === R);
    const w = h2h.filter(g => g.result === 'W').length;
    return `<section class="panel s6" style="--lc:${accentFor(L.f)};--rc:${accentFor(R.f)}">
    <header><div><span class="eyebrow">Season so far</span><h2>Tale of the tape</h2></div><span class="aside">${done(L)} games</span></header>
    <div class="tape">${rows.map(([lbl, a, b, d]) => `<div class="trow"><span class="${d > 0 ? 'edge' : ''}" style="--c:var(--lc)">${esc(a)}</span><em>${lbl}</em><span class="${d < 0 ? 'edge' : ''}" style="--c:var(--rc)">${esc(b)}</span></div>`).join('')}
      ${h2h.length ? `<div class="trow"><span>${w}</span><em>Head to head</em><span>${h2h.length - w}</span></div>`
        : '<div class="trow"><span></span><em>First meeting this season</em><span></span></div>'}
    </div>
  </section>`;
  }

  function around(week, L) {
    const seen = new Set(), out = [];
    for (const t of Object.values(M.teams)) {
      const g = gamesOf(t).find(x => x.week === week);
      if (!g || !g.opp || seen.has(t.id)) continue;
      seen.add(t.id); seen.add(g.opp.id); out.push(g);
    }
    return `<section class="panel s6">
    <header><div><span class="eyebrow">Week ${week}</span><h2>Around the league</h2></div></header>
    <div class="around">${out.map(g => { const a = g.me.points, b = g.oppRow.points, st = state(g), on = g.me.roster_id === L.id || g.oppRow.roster_id === L.id;
      return `<a class="arow${on ? ' on' : ''}" href="${link(week, g.me.roster_id)}">
        <span class="at">${markSVG(M.teams[g.me.roster_id].f, 'mini')} ${esc(M.teams[g.me.roster_id].f.location)}</span>
        <b class="${st !== 'upcoming' && a > b ? 'win' : ''}">${st === 'upcoming' ? '' : f1(a)}</b>
        <em class="${st}">${st === 'final' ? 'Final' : st === 'live' ? 'Live' : 'vs'}</em>
        <b class="${st !== 'upcoming' && b > a ? 'win' : ''}">${st === 'upcoming' ? '' : f1(b)}</b>
        <span class="at r">${esc(g.opp.f.location)} ${markSVG(g.opp.f, 'mini')}</span></a>`; }).join('')}</div>
  </section>`;
  }

  function render() {
    const { team, week } = parseRoute();
    const L = M.teams[team], playoffWeek = week > M.league.regularSeasonWeeks;
    const g = gamesOf(L).find(x => x.week === week) || (playoffWeek ? null : L.games[0]);
    const content = document.getElementById('content');
    if (!g || !g.opp) { document.getElementById('hero').innerHTML = ''; document.getElementById('crumb').innerHTML = `Matchups · ${esc(M.state.season)} · <strong>Week ${week}</strong>`; content.innerHTML = `<div class="empty">${playoffWeek ? `${esc(L.f.location)} has no playoff game in Week ${week}${(M.bracket && M.bracket.rounds && (M.bracket.rounds[0].byes || []).includes(L.id) && week === M.league.regularSeasonWeeks + 1) ? ' (first-round bye)' : ''}. <a href="standings.html#playoffs">See the bracket</a>` : 'No matchup that week.'}</div>`; return; }
    const R = g.opp;
    document.getElementById('crumb').innerHTML = `Matchups · ${esc(M.state.season)} · <strong>${g.playoff ? `${esc(g.label)} · ` : ''}Week ${g.week}</strong>`;
    document.getElementById('hero').innerHTML = hero(L, R, g) + weekStrip(L, g.week);
    // Weeks before the Hub took over (startWeek) were played by the placeholder league: its scores count, but its
    // lineups are of players who aren't on these rosters any more, so they aren't shown.
    const placeholder = M.hub && g.week < (M.hubStart || 0);
    const note = placeholder ? `<section class="panel s12"><header><div><span class="eyebrow">Week ${g.week} · placeholder league</span><h2>${g.final ? 'Played before the Hub took over' : 'Hub matchups start in Week ' + M.hubStart}</h2></div></header>
      <p class="pmeta">The 2026 test season's first weeks were played by a placeholder league. ${g.final ? 'Its score stands in the standings and the record book, but its lineups belonged to placeholder rosters, so they aren\'t shown.' : 'This week still belongs to it, so nothing here counts for your Hub roster.'} From Week ${M.hubStart} on, every matchup is your Hub lineup, scored live.</p></section>` : '';
    content.innerHTML = `<div class="grid">${placeholder ? note : lineups(L, R, g)}${tape(L, R)}${around(g.week, L)}</div>`;
    document.title = `${L.f.location} vs ${R.f.location} · Week ${g.week}`;
    paintHelmets(document).catch(e => console.error(e));
  }

  async function start() {
    try {
      M = await Hub.load();
      document.getElementById('sample-flag').hidden = M.live;
      UI.myTeam(M);
      document.getElementById('season').innerHTML = `<strong>${esc(M.state.season)} season</strong><span>Week ${M.current}</span>`;
      render();
      addEventListener('hashchange', () => { render(); scrollTo({ top: 0 }); });
      // Hub matchups score live: refresh the points every minute while this week is on screen (the page keeps its place).
      if (M.hub) setInterval(async () => {
        if (document.hidden || parseRoute().week !== M.current) return;
        if (await Hub.liveRefresh(M).catch(() => false)) render();
      }, 60000);
    } catch (e) {
      document.getElementById('content').innerHTML = `<div class="error">Couldn't load league data. ${esc(e.message)}</div>`;
      console.error(e);
    }
  }
  start();
})();
