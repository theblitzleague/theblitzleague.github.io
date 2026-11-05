/* Schedule: the whole league's regular season.
   Tabs: #w<week> (By week; defaults to the current week) and #grid (every team's opponent each week).
   Lines, billing chips and the weekly prize come from js/ui.js, so they match the home page and matchup page. */
(function () {
  const { esc, f1, f2, rec, leagueHero, tabsHTML, boot, allGames } = UI;
  let M;
  const mlink = (w, id) => `matchup.html#w${w}-t${id}`;
  const state = g => (g.final ? 'final' : g.live ? 'live' : 'upcoming');
  const weeks = () => Array.from({ length: M.league.regularSeasonWeeks }, (_, i) => i + 1);
  const thisWeek = () => Math.min(M.current, M.league.regularSeasonWeeks);
  const weekState = w => (w < M.current ? 'final' : w === M.current ? 'live' : 'upcoming');
  const STATE = { final: 'Final', live: 'Live', upcoming: 'Upcoming' };

  function strip(week) {
    return `<nav class="weeks sched-weeks" aria-label="Weeks"><div class="wrap">${weeks().map(w => `
      <a class="wk${w === week ? ' now' : ''}" href="#w${w}">W${w}${weekState(w) === 'live' ? '<span class="r live">Live</span>' : ''}</a>`).join('')}</div></nav>`;
  }

  function card(g) {
    const L = M.teams[g.me.roster_id], R = g.opp, st = state(g), a = g.me.points, b = g.oppRow.points;
    const line = (t, v, win) => `<div class="bline${win ? ' win' : ''}">${markSVG(t.f, 'mini')}<span>${esc(t.f.location)}</span><small>${rec(t)}</small><b>${st === 'upcoming' ? '' : f1(v)}</b></div>`;
    return `<a class="bcard" href="${mlink(g.week, L.id)}"><span class="bstate ${st}">${STATE[st]}</span>
      ${line(L, a, st !== 'upcoming' && a > b)}${line(R, b, st !== 'upcoming' && b > a)}
      ${UI.billingHTML(M, g, { tagsOnly: true })}${UI.oddsHTML(M, g, true)}</a>`;
  }

  function byWeek(week) {
    const games = allGames(M, g => g.week === week), st = weekState(week);
    const hi = st === 'final' && UI.weeklyWinners(M).find(x => x.week === week);
    const aside = hi ? `High score: ${hi.winners.map(t => esc(t.f.location)).join(', ')} ${f2(hi.points)} ${UI.cash(hi.each)}`
      : st === 'live' ? 'In progress' : `${games.length} games`;
    return `${strip(week)}<div class="grid"><section class="panel s12">
      <header><div><span class="eyebrow">${esc(M.state.season)} · ${STATE[st] === 'Live' ? 'This week' : STATE[st]}</span><h2>Week ${week}</h2></div><span class="aside">${aside}</span></header>
      ${games.length ? `<div class="board sched-board">${games.map(card).join('')}</div>` : '<div class="empty">No games scheduled this week.</div>'}
      <p class="footnote">Lines are the site's own projection from each team's scoring before that week; finished games show the closing spread and who covered. Tags show only when true.</p>
    </section></div>`;
  }

  function grid() {
    const cur = thisWeek();
    const teams = M.league.divisions.flatMap(d => Object.values(M.teams).filter(t => t.division === d).sort((a, b) => a.divRank - b.divRank));
    const head = `<tr><th>Team</th>${weeks().map(w => `<th class="${w === cur ? 'now' : ''}"><a href="#w${w}">W${w}</a></th>`).join('')}</tr>`;
    const rows = teams.map(t => `<tr><td class="gteam" style="--dc:${UI.divInk(t.division)}"><a href="team.html?team=${t.id}#schedule">${markSVG(t.f, 'mini')}<span>${esc(t.f.abbr || t.f.location)}</span></a><small>${rec(t)}</small></td>${weeks().map(w => {
      const g = t.games.find(x => x.week === w);
      if (!g || !g.opp) return `<td class="${w === cur ? 'now' : ''}"><span class="gc bye">-</span></td>`;
      const cls = [g.result || (g.live ? 'live' : ''), g.opp.division === t.division ? 'div' : ''].filter(Boolean).join(' ');
      const tip = `Week ${w} vs ${g.opp.f.location}${g.final ? ` · ${g.result} ${f2(g.me.points)}-${f2(g.oppRow.points)}` : ''}`;
      return `<td class="${w === cur ? 'now' : ''}"><a class="gc ${cls}" href="${mlink(w, t.id)}" title="${esc(tip)}"><span>${esc(g.opp.f.abbr || g.opp.f.location)}</span>${g.result ? `<small>${g.result}</small>` : ''}</a></td>`;
    }).join('')}</tr>`).join('');
    return `<div class="grid"><section class="panel s12">
      <header><div><span class="eyebrow">${esc(M.state.season)} regular season</span><h2>Team grid</h2></div><span class="aside">${M.league.regularSeasonWeeks} weeks</span></header>
      <div class="tablewrap"><table class="sgrid"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
      <p class="footnote">Each cell is that week's opponent; green won, red lost. An underline marks a division game. The highlighted column is this week. Tap any cell for the matchup.</p>
    </section></div>`;
  }

  function route() {
    const h = location.hash.slice(1), m = /^w(\d+)$/.exec(h), w = m && +m[1];
    const isGrid = h === 'grid', week = w >= 1 && w <= M.league.regularSeasonWeeks ? w : thisWeek();
    document.getElementById('tabs').innerHTML = tabsHTML([['w' + week, 'By week'], ['grid', 'Team grid']], isGrid ? 'grid' : 'w' + week);
    document.getElementById('content').innerHTML = isGrid ? grid() : byWeek(week);
    // Phones: start the grid (and the week strip) scrolled to this week instead of week 1.
    const box = document.querySelector(isGrid ? '.tablewrap' : '.sched-weeks .wrap'), at = document.querySelector(isGrid ? 'th.now' : '.wk.now');
    if (box && at) box.scrollLeft = Math.max(0, at.offsetLeft - box.clientWidth / 2 + at.offsetWidth / 2);
  }

  boot('League · <strong>Schedule</strong>', m => {
    M = m;
    document.getElementById('hero').innerHTML = leagueHero(M, `${M.state.season} season · Week ${M.current}`, 'Schedule', `${M.league.regularSeasonWeeks}-week regular season · playoffs start week ${M.league.regularSeasonWeeks + 1}`);
    route();
    addEventListener('hashchange', route);
  });
})();
