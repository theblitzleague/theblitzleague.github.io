/* The Blitz Network: real NFL news and matchups, read through Blitz League rosters. Data: js/nfl.js.
   Tabs: #headlines, #players, #injuries, #matchups, #defenses, #slate, #trending, #rookies. */
(function () {
  const { esc, f1, shot, pid, wash, tabsHTML, boot } = UI;
  let M, N;
  const TABS = [['headlines', 'Headlines'], ['players', 'Players'], ['injuries', 'Injuries'], ['matchups', 'Matchups'], ['defenses', 'Defense vs position'], ['slate', 'NFL slate'], ['trending', 'Trending'], ['rookies', 'Rookies & College']];
  const P = id => M.players[id] || { full_name: `Player ${id}`, position: '?' };
  const WHERE = { starter: 'Starting', bench: 'Bench', taxi: 'Taxi', IR: 'IR' };
  const TYPE = { HeadlineNews: 'News', Story: 'Story', Media: 'Video', Preview: 'Preview', Recap: 'Recap' };
  const SEV = ['Out', 'Doubtful', 'Questionable', 'Injured Reserve', 'Suspension', 'Physically Unable to Perform'];
  const sev = s => { const i = SEV.indexOf(s); return i < 0 ? SEV.length : i; };
  const POSN = { QB: 'QBs', RB: 'RBs', WR: 'WRs', TE: 'TEs', K: 'kickers', DL: 'DL', LB: 'LBs', DB: 'DBs' };

  function ago(iso) {
    const t = Date.parse(iso); if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`; if (m < 24 * 60) return `${Math.round(m / 60)}h ago`;
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  const kick = iso => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const ordn = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const own = (o, short) => `<span class="nw-own" style="--lc:${UI.accentFor(o.t.f)}">${markSVG(o.t.f, 'mini')}<span>${short ? '' : `${WHERE[o.where] || o.where} · `}${esc(o.t.f.location)}</span></span>`;
  const who = id => { const p = P(id); return `<span class="nw-who"${pid(id)}>${shot(id, 'nw-shot')}<span><b>${esc(p.full_name)}</b><small>${esc(p.nflPos || p.position)}${N.teamOf(id) ? ' · ' + esc(N.teamOf(id)) : ''}</small></span></span>`; };
  // "most", "2nd most", ... "fewest" given up to that position, out of the teams with data.
  const rankWord = r => { const n = Object.keys(N.dvp).length; return r === 1 ? 'the most' : r === n ? 'the fewest' : r <= n / 2 ? `the ${ordn(r)} most` : `the ${ordn(n - r + 1)} fewest`; };
  const heat = r => { const n = Object.keys(N.dvp).length || 32, x = (r - 1) / (n - 1); return `--h:${Math.round(140 - x * 140)}`; };   // green (easy) to red (tough)

  function source() {
    const l = N.live, parts = [];
    parts.push(l.news ? 'Headlines live from ESPN' : `Headlines from ESPN as of ${ago(N.built)}`);
    if (N.dvpThrough) parts.push(`defense numbers through NFL week ${N.dvpThrough}, in ${N.scoring === 'league' ? 'Blitz League' : 'Sleeper default'} scoring`);
    return parts.join(' · ');
  }

  // ---------- Headlines ----------
  function storyTag(n) { return `<span class="net-tag">${esc(TYPE[n.type] || n.type || 'News')}</span>${n.premium ? '<span class="nw-plus">ESPN+</span>' : ''}`; }
  const meta = n => ['ESPN', n.byline && esc(n.byline), ago(n.at)].filter(Boolean).join(' · ');
  const chips = n => (n.blitz.length ? `<div class="nw-chips">${n.blitz.slice(0, 4).map(b => `<span class="nw-chip"${pid(b.id)}>${esc(P(b.id).full_name)}${own(b)}</span>`).join('')}${n.blitz.length > 4 ? `<span class="nw-more">+${n.blitz.length - 4} more</span>` : ''}</div>` : '');
  const link = (n, cls, inner) => (n.url ? `<article class="${cls}"><a class="nw-hit" href="${esc(n.url)}" target="_blank" rel="noopener" aria-label="${esc(n.head)} (ESPN)"></a>${inner}</article>` : `<article class="${cls}">${inner}</article>`);

  function leadArt(n) {
    const b = n.blitz[0], id = b ? b.id : n.pids[0];
    if (id) return `<div class="net-art nw-art" style="${b ? `--lw:${wash(b.t.f)}` : ''}">${shot(id, 'nw-lead-shot')}${b ? markSVG(b.t.f, 'nw-lead-mark') : ''}</div>`;
    return `<div class="net-art"><img class="net-logo" src="${esc((M.league.network || {}).mark || M.league.logo)}" alt=""></div>`;
  }
  const item = n => link(n, 'nw-story', `${n.blitz[0] ? shot(n.blitz[0].id, 'nw-thumb') : n.pids[0] ? shot(n.pids[0], 'nw-thumb') : `<img class="nw-thumb net-mark" src="${esc((M.league.network || {}).mark || M.league.logo)}" alt="">`}
    <div>${storyTag(n)}<h3>${esc(n.head)}</h3>${n.dek ? `<p>${esc(n.dek)}</p>` : ''}${chips(n)}<span class="pmeta">${meta(n)}</span></div>`);

  // First 10, then a button for the rest.
  const more = (list, cls, empty) => !list.length ? empty : `<div class="${cls}">${list.slice(0, 10).map(item).join('')}</div>${list.length > 10
    ? `<details class="nw-reveal"><summary>${list.length - 10} more</summary><div class="${cls}">${list.slice(10).map(item).join('')}</div></details>` : ''}`;
  function headlines() {
    const all = N.news.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!all.length) return `<div class="grid"><section class="panel s12"><div class="empty">No NFL headlines right now.</div></section></div>`;
    const blitz = all.filter(n => n.blitz.length), rest = all.filter(n => !n.blitz.length);
    const lead = blitz[0] || all[0];
    return `<div class="grid">
      <section class="panel s12 network">
        <header><div><span class="eyebrow">NFL week ${N.week} · the stories that hit Blitz rosters</span><h2>Top story</h2></div><span class="aside">${blitz.length} of ${all.length} touch Blitz players</span></header>
        ${link(lead, 'net-lead nw-lead', `${leadArt(lead)}<div class="net-copy">${storyTag(lead)}<h3>${esc(lead.head)}</h3><p>${esc(lead.dek)}</p>${chips(lead)}<span class="pmeta">${meta(lead)}</span></div>`)}
      </section>
      <section class="panel s7"><header><div><span class="eyebrow">Stories naming Blitz-rostered players</span><h2>Blitz wire</h2></div></header>
        ${more(blitz.filter(n => n !== lead), 'nw-list', '<div class="empty">No other stories name a Blitz player.</div>')}</section>
      <section class="panel s5"><header><div><span class="eyebrow">Everything else from ESPN</span><h2>Around the NFL</h2></div></header>
        ${more(rest.filter(n => n !== lead), 'nw-list compact', '')}</section>
    </div>`;
  }

  // ---------- Injuries ----------
  function injuries() {
    const mine = N.injuries.filter(x => x.own).sort((a, b) => (a.own.where === 'starter' ? 0 : 1) - (b.own.where === 'starter' ? 0 : 1) || sev(a.status) - sev(b.status) || String(b.at).localeCompare(String(a.at)));
    const startersHurt = mine.filter(x => x.own.where === 'starter' && ['Out', 'Doubtful', 'Questionable'].includes(x.status));
    const byTeam = {};
    for (const x of startersHurt) (byTeam[x.own.t.id] || (byTeam[x.own.t.id] = { t: x.own.t, n: 0 })).n++;
    const row = x => `<div class="nw-inj">${who(x.pid)}<span class="nw-status s${sev(x.status)}">${esc(x.status)}</span>
      <div class="nw-note">${x.note ? esc(x.note) : ''}<span class="pmeta">ESPN · ${ago(x.at)}</span></div>${own(x.own)}</div>`;
    return `<div class="grid">
      ${startersHurt.length ? `<section class="panel s12"><header><div><span class="eyebrow">In this week's Blitz lineups</span><h2>Starters on the report</h2></div><span class="aside">${startersHurt.length} starters</span></header>
        <div class="nw-teamhurt">${Object.values(byTeam).sort((a, b) => b.n - a.n).map(b => `<a href="team.html?team=${b.t.id}" style="--lc:${UI.accentFor(b.t.f)}">${markSVG(b.t.f, 'mini')}<b>${esc(b.t.f.location)}</b><span>${b.n}</span></a>`).join('')}</div>
        <div class="nw-injlist">${startersHurt.map(row).join('')}</div></section>` : ''}
      <section class="panel s12"><header><div><span class="eyebrow">Every Blitz-rostered player with a designation</span><h2>Injury report</h2></div><span class="aside">${mine.length} players</span></header>
        ${mine.length ? `<div class="nw-injlist">${mine.filter(x => !startersHurt.includes(x)).map(row).join('')}</div>` : '<div class="empty">No Blitz-rostered player has an injury designation.</div>'}
        <p class="footnote">From ESPN's NFL injury report (${N.injuries.length} designations league-wide${N.live.injuries ? ', live' : `, as of ${ago(N.built)}`}). Notes are ESPN's. Starters are this week's Blitz lineups.</p></section>
    </div>`;
  }

  // ---------- Matchups ----------
  function matchups() {
    const hurt = new Map(N.injuries.filter(x => x.pid).map(x => [x.pid, x]));
    const S = N.starters.filter(s => s.pos && s.rank && !s.bye && !['Out', 'Doubtful', 'Injured Reserve'].includes((hurt.get(s.id) || {}).status));
    const alerts = N.starters.filter(s => s.bye || ['Out', 'Doubtful', 'Injured Reserve'].includes((hurt.get(s.id) || {}).status))
      .map(s => ({ s, why: s.bye ? `${esc(s.team)} is on bye` : esc(hurt.get(s.id).status) }));
    const card = (s, good) => `<div class="nw-mu ${good ? 'good' : 'bad'}">${who(s.id)}
      <div class="nw-vs"><b>${s.game.home ? 'vs' : '@'} ${esc(s.game.vs)}</b><small>${esc(s.game.vs)} gives up ${rankWord(s.rank)} to ${POSN[s.pos]}<br>${f1(s.allow)} a game</small></div>
      <div class="nw-proj">${s.proj != null ? `<b>${f1(s.proj)}</b><small>proj</small>` : ''}</div>${own(s, true)}</div>`;
    const best = S.slice().sort((a, b) => a.rank - b.rank || (b.proj || 0) - (a.proj || 0)).slice(0, 12);
    const worst = S.slice().sort((a, b) => b.rank - a.rank || (b.proj || 0) - (a.proj || 0)).slice(0, 12);
    // Blitz head-to-heads this week: projected totals from each side's starters.
    const seen = new Set(), h2h = [];
    for (const t of Object.values(M.teams)) {
      const g = t.games.find(x => x.week === M.current); if (!g || !g.opp || seen.has(t.id)) continue; seen.add(t.id); seen.add(g.opp.id);
      const side = tt => { const st = N.starters.filter(s => s.t === tt); return { t: tt, proj: st.reduce((a, s) => a + (s.proj || 0), 0), n: st.filter(s => s.proj != null).length, of: st.length, out: alerts.filter(a => a.s.t === tt).length }; };
      h2h.push([side(t), side(g.opp), g]);
    }
    const hasProj = Object.keys(N.proj).length > 0;
    return `<div class="grid">
      ${alerts.length ? `<section class="panel s12 nw-alerts"><header><div><span class="eyebrow">Fix these before kickoff</span><h2>Lineup alerts</h2></div><span class="aside">${alerts.length} starters</span></header>
        <div class="nw-alertlist">${alerts.map(a => `<div class="nw-alert">${who(a.s.id)}<span class="nw-status s0">${a.why}</span>${own(a.s, true)}</div>`).join('')}</div>
        <p class="footnote">Players in this week's Blitz lineups who are on bye, out, doubtful or on IR.</p></section>` : ''}
      ${hasProj ? `<section class="panel s12"><header><div><span class="eyebrow">Week ${M.current} · projected from Sleeper's player projections, in Blitz scoring</span><h2>Blitz matchups by the numbers</h2></div><a class="aside" href="matchup.html">All matchups</a></header>
        <div class="nw-h2h">${h2h.map(([a, b, g]) => `<a class="nw-game" href="matchup.html#w${g.week}-t${a.t.id}">
          ${[a, b].map(x => `<div class="nw-side${x.proj > (x === a ? b : a).proj ? ' fav' : ''}">${markSVG(x.t.f, 'mini')}<span>${esc(x.t.f.location)}</span><b>${f1(x.proj)}</b>${x.out ? `<em>${x.out} alert${x.out > 1 ? 's' : ''}</em>` : ''}</div>`).join('')}</a>`).join('')}</div>
        <p class="footnote">Sum of each lineup's projections. A starter with no projection (no game, or Sleeper doesn't project him) counts as zero.</p></section>` : ''}
      <section class="panel s6"><header><div><span class="eyebrow">Blitz starters facing defenses that give up the most at their position</span><h2>Smash spots</h2></div></header>
        <div class="nw-mulist">${best.map(s => card(s, true)).join('') || '<div class="empty">No matchup data yet.</div>'}</div></section>
      <section class="panel s6"><header><div><span class="eyebrow">Blitz starters facing defenses that give up the least</span><h2>Tough draws</h2></div></header>
        <div class="nw-mulist">${worst.map(s => card(s, false)).join('') || '<div class="empty">No matchup data yet.</div>'}</div></section>
      <p class="footnote s12">Points allowed are per game, through NFL week ${N.dvpThrough}, scored with ${N.scoring === 'league' ? 'the Blitz League’s own scoring' : 'Sleeper’s default scoring'}. For DL, LB and DB it is what those defenders scored against that offense. Full table on the Defenses tab.</p>
    </div>`;
  }

  // ---------- Defenses ----------
  let sortBy = null;
  function defenses() {
    const teams = Object.keys(N.dvp);
    if (!teams.length) return `<div class="grid"><section class="panel s12"><div class="empty">No defense numbers yet.</div></section></div>`;
    const rows = teams.sort((a, b) => (sortBy ? N.dvp[a].rank[sortBy] - N.dvp[b].rank[sortBy] : a.localeCompare(b)));
    const opp = abbr => { const g = N.gameOf(abbr); return g ? `${g.home ? 'vs' : '@'} ${g.vs}` : N.byes.includes(abbr) ? 'Bye' : ''; };
    const th = p => `<th><button type="button" data-sort="${p}" aria-pressed="${sortBy === p}">${p}</button></th>`;
    return `<div class="grid"><section class="panel s12">
      <header><div><span class="eyebrow">Points allowed per game, through NFL week ${N.dvpThrough}</span><h2>Defense vs position</h2></div><span class="aside nw-key">Green: easy matchup · red: tough</span></header>
      <div class="tablewrap"><table class="nw-dvp"><thead><tr><th><button type="button" data-sort="" aria-pressed="${!sortBy}">Team</button></th><th>Wk ${N.week}</th>${NFL.OFF.map(th).join('')}<th class="gap"></th>${NFL.IDP.map(th).join('')}</tr></thead>
        <tbody>${rows.map(t => { const d = N.dvp[t]; const td = p => `<td style="${heat(d.rank[p])}" title="${esc(t)} gives up ${rankWord(d.rank[p])} to ${POSN[p]}"><b>${f1(d[p])}</b><small>${ordn(d.rank[p])}</small></td>`;
          return `<tr><th>${esc(t)}<small>${d.g} G</small></th><td class="opp">${esc(opp(t))}</td>${NFL.OFF.map(td).join('')}<td class="gap"></td>${NFL.IDP.map(td).join('')}</tr>`; }).join('')}</tbody></table></div>
      <p class="footnote">Each cell: points per game that position has scored against this team, and its rank (1st = gives up the most, the best matchup). Scored with ${N.scoring === 'league' ? 'the Blitz League’s own settings' : 'Sleeper’s defaults'} from Sleeper's weekly stats. DL, LB and DB columns are what opposing defenders scored against this team's offense: start your IDP against the green ones. Tap a column to sort.</p>
    </section></div>`;
  }

  // ---------- NFL slate ----------
  function slate() {
    const byTeam = {};
    for (const s of N.starters) if (s.team) (byTeam[s.team] || (byTeam[s.team] = [])).push(s);
    const side = (x, g) => `<div class="nw-team${g.state === 'post' && x.winner ? ' win' : ''}"><b>${esc(x.abbr)}</b><span>${esc(x.short)}</span><small>${esc(x.rec)}</small>${g.state !== 'pre' ? `<em>${esc(x.score)}</em>` : ''}</div>`;
    const people = list => (list || []).sort((a, b) => (b.proj || 0) - (a.proj || 0)).map(s => `<span class="nw-chip"${pid(s.id)}>${esc(P(s.id).full_name)}${own(s, true)}</span>`).join('');
    const games = N.games.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const byes = N.byes.map(b => ({ b, list: byTeam[b] || [] }));
    return `<div class="grid">
      <section class="panel s12"><header><div><span class="eyebrow">NFL week ${N.week}${N.live.games ? ' · live from ESPN' : ''}</span><h2>The slate</h2></div><span class="aside">${games.length} games${N.byes.length ? ` · bye: ${N.byes.map(esc).join(', ')}` : ''}</span></header>
        <div class="nw-slate">${games.map(g => { const n = (byTeam[g.away.abbr] || []).length + (byTeam[g.home.abbr] || []).length;
          return `<div class="nw-nfl ${esc(g.state)}"><div class="nw-when"><b>${g.state === 'pre' ? esc(kick(g.at)) : esc(g.detail)}</b><span>${esc(g.net || '')}</span></div>
            ${side(g.away, g)}<span class="nw-at">${g.neutral ? 'vs' : '@'}</span>${side(g.home, g)}
            <div class="nw-line">${g.line ? `<b>${esc(g.line)}</b>` : ''}${g.ou ? `<span>O/U ${esc(g.ou)}</span>` : ''}${g.neutral && g.venue ? `<span>${esc(g.venue)}</span>` : ''}</div>
            ${g.recap ? `<p class="nw-recap">${esc(g.recap)}</p>` : ''}
            <div class="nw-blitz"><span class="eyebrow">${n ? `${n} Blitz starter${n > 1 ? 's' : ''}` : 'No Blitz starters'}</span>${people([...(byTeam[g.away.abbr] || []), ...(byTeam[g.home.abbr] || [])])}</div></div>`; }).join('')}</div></section>
      ${byes.length ? `<section class="panel s12"><header><div><span class="eyebrow">Not playing this week</span><h2>On bye</h2></div></header>
        <div class="nw-byes">${byes.map(x => `<div><b>${esc(x.b)}</b>${x.list.length ? people(x.list) : '<span class="pmeta">No Blitz starters</span>'}</div>`).join('')}</div></section>` : ''}
    </div>`;
  }

  // ---------- Trending ----------
  function trending() {
    const col = (rows, kind) => rows.filter(r => M.players[r.player_id]).slice(0, 15).map((r, i) => {
      const o = N.owner(r.player_id);
      return `<div class="nw-trend"><span class="rk">${i + 1}</span>${who(r.player_id)}<span class="nw-count ${kind}">${kind === 'add' ? '+' : '−'}${r.count.toLocaleString('en-US')}</span>${o ? own(o) : '<span class="nw-fa">Free agent</span>'}</div>`;
    }).join('');
    return `<div class="grid">
      <section class="panel s6"><header><div><span class="eyebrow">Most added across Sleeper, last 24 hours</span><h2>Rising</h2></div></header><div class="nw-trends">${col(N.trending.add || [], 'add') || '<div class="empty">Nothing yet.</div>'}</div></section>
      <section class="panel s6"><header><div><span class="eyebrow">Most dropped across Sleeper, last 24 hours</span><h2>Falling</h2></div></header><div class="nw-trends">${col(N.trending.drop || [], 'drop') || '<div class="empty">Nothing yet.</div>'}</div></section>
      <p class="footnote s12">Counts are every Sleeper league, not just this one. "Free agent" means no Blitz team rosters him.${N.live.trending ? '' : ` As of ${ago(N.built)}.`}</p>
    </div>`;
  }

  // ---------- Rookies & College ----------
  let rkView = 'all', bbView = 'scorers';
  // ESPN prospect positions -> the Blitz slot they'd fill (null: doesn't score in this league).
  const BLITZ_POS = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', PK: 'K', K: 'K', EDGE: 'DL', DE: 'DL', DT: 'DL', DL: 'DL', LB: 'LB', CB: 'DB', S: 'DB', DB: 'DB' };
  const n0 = v => (v == null ? '-' : Math.round(v).toLocaleString('en-US'));
  const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const chipRow = (attr, cur, opts) => `<div class="nw-filter" role="group">${opts.map(([k, l]) => `<button type="button" data-${attr}="${k}" aria-pressed="${cur === k}">${l}</button>`).join('')}</div>`;

  function rookieRows() {
    return Object.entries(N.rookies).filter(([id]) => M.players[id]).map(([id, w]) => {
      const pts = w.map(x => x[1]), snaps = w.map(x => x[2]).filter(x => x != null), last = pts.slice(-3);
      const p = P(id), idp = NFL.IDP.includes(p.position);
      return { id, p, idp, gp: w.length, ppg: avg(pts), l3: avg(last), snap: snaps.length ? snaps[snaps.length - 1] : null,
        snapEarly: snaps.length ? avg(snaps.slice(0, Math.min(3, snaps.length))) : null, owner: N.owner(id), proj: N.proj[id] ? N.proj[id][0] : null };
    });
  }
  function rookieTable(rows) {
    const trend = r => { const d = r.l3 - r.ppg; return Math.abs(d) < 1 ? '<span class="nw-flat">steady</span>' : `<span class="${d > 0 ? 'nw-up' : 'nw-down'}">${d > 0 ? '▲' : '▼'} ${f1(Math.abs(d))}</span>`; };
    return `<div class="tablewrap"><table class="nw-rk"><thead><tr><th>#</th><th>Rookie</th><th class="num">GP</th><th class="num">Pts/G</th><th class="num">Last 3</th><th>Trend</th><th class="num">Snaps</th><th class="num">Proj</th><th>Blitz</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr><td class="rk">${i + 1}</td><td>${who(r.id)}</td><td class="num">${r.gp}</td><td class="num strong">${f1(r.ppg)}</td><td class="num">${f1(r.l3)}</td><td>${trend(r)}</td>
        <td class="num">${r.snap != null ? r.snap + '%' : '-'}</td><td class="num">${r.proj != null ? f1(r.proj) : '-'}</td><td>${r.owner ? own(r.owner, true) : '<span class="nw-fa">Free agent</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function statLine(b) {
    const s = b.stats; if (!s) return '<span class="pmeta">No college stats from ESPN this season</span>';
    const parts = [];
    if (s.pass[0]) parts.push(`${n0(s.pass[0])} pass yd, ${n0(s.pass[1])} TD, ${n0(s.pass[2])} INT`);
    if (s.rush[0] && (b.pos === 'QB' || b.pos === 'RB' || s.rush[0] > 100)) parts.push(`${n0(s.rush[0])} rush yd, ${n0(s.rush[1])} TD`);
    if (s.rec[0]) parts.push(`${n0(s.rec[0])} rec, ${n0(s.rec[1])} yd, ${n0(s.rec[2])} TD`);
    if (BLITZ_POS[b.pos] && NFL.IDP.includes(BLITZ_POS[b.pos])) parts.push(`${n0(s.def[0])} tkl, ${s.def[1] ? f1(s.def[1]).replace(/\.0$/, '') : 0} TFL, ${s.def[2] ? f1(s.def[2]).replace(/\.0$/, '') : 0} sacks, ${n0(s.def[3])} INT, ${n0(s.def[4])} PD`);
    return `<span class="nw-cstat">${n0(s.gp)} G · ${parts.join(' · ') || 'no stats yet'}</span>`;
  }
  function rookies() {
    const all = rookieRows().sort((a, b) => b.ppg - a.ppg);
    const pick = { all: r => r.gp >= 2, off: r => r.gp >= 2 && !r.idp, idp: r => r.gp >= 2 && r.idp, fa: r => r.gp >= 2 && !r.owner }[rkView];
    const shown = all.filter(pick);
    // Stash watch: unowned rookies whose scoring or playing time is climbing.
    const stash = all.filter(r => !r.owner && r.gp >= 2 && ((r.l3 >= r.ppg * 1.2 && r.l3 >= 6) || (r.snap != null && r.snapEarly != null && r.snap - r.snapEarly >= 15 && r.snap >= 50)))
      .sort((a, b) => b.l3 - a.l3).slice(0, 8);
    const board = N.bigBoard.filter(b => bbView === 'all' || (bbView === 'scorers' ? BLITZ_POS[b.pos] : bbView === 'off' ? ['QB', 'RB', 'WR', 'TE'].includes(BLITZ_POS[b.pos]) : NFL.IDP.includes(BLITZ_POS[b.pos])));
    const onBoard = new Map(N.bigBoard.map(b => [b.cid, b])), byName = new Map(N.bigBoard.map(b => [NFL.norm(b.name), b]));
    const C = N.college, LEAD = [['passingYards', 'Passing'], ['rushingYards', 'Rushing'], ['receivingYards', 'Receiving']];
    const tagBoard = b => (b ? `<span class="nw-bb">Big Board #${b.rank}</span>` : '');
    const cnews = (C.news || []).map(n => ({ ...n, bb: n.athletes.map(a => byName.get(NFL.norm(a))).filter(Boolean) }))
      .sort((a, b) => (b.bb.length ? 1 : 0) - (a.bb.length ? 1 : 0) || String(b.at).localeCompare(String(a.at)));
    const citem = n => `<article class="nw-story cfb">${n.url ? `<a class="nw-hit" href="${esc(n.url)}" target="_blank" rel="noopener" aria-label="${esc(n.head)} (ESPN)"></a>` : ''}
      <div>${storyTag(n)}${n.bb.map(tagBoard).join('')}<h3>${esc(n.head)}</h3><span class="pmeta">${meta(n)}</span></div></article>`;
    return `<div class="grid">
      <section class="panel s12"><header><div><span class="eyebrow">${esc(N.season)} NFL rookies · points in Blitz scoring</span><h2>Rookie report</h2></div><span class="aside">${shown.length} rookies</span></header>
        ${chipRow('rk', rkView, [['all', 'All'], ['off', 'Offense'], ['idp', 'IDP'], ['fa', 'Free agents']])}
        ${shown.length ? rookieTable(shown.slice(0, 25)) : '<div class="empty">No rookies match.</div>'}
        ${shown.length > 25 ? `<details class="nw-reveal"><summary>${shown.length - 25} more</summary>${rookieTable(shown.slice(25))}</details>` : ''}
        <p class="footnote">Rookies with 2+ games, through NFL week ${N.dvpThrough}. Last 3 is the average of his three most recent games; the trend compares it with his season average. Snaps: share of his team's offensive (or defensive) snaps in his latest game.</p></section>
      <section class="panel s5"><header><div><span class="eyebrow">Unowned in the Blitz and trending up</span><h2>Stash watch</h2></div></header>
        ${stash.length ? `<div class="nw-trends">${stash.map(r => `<div class="nw-trend nw-stash">${who(r.id)}<span class="nw-count add">${f1(r.l3)}<small> last 3</small></span>
          <span class="pmeta">${f1(r.ppg)} season${r.snap != null ? ` · ${r.snapEarly != null ? Math.round(r.snapEarly) + '% → ' : ''}${r.snap}% snaps` : ''}</span></div>`).join('')}</div>`
          : '<div class="empty">No unowned rookie is trending up right now.</div>'}
        <p class="footnote">Free-agent rookies whose last three games beat their season average by 20%+, or whose snap share jumped 15+ points to at least half the snaps.</p></section>
      <section class="panel s7"><header><div><span class="eyebrow">ESPN's ranked prospects for the ${esc(N.draftYear)} NFL Draft</span><h2>${esc(N.draftYear)} Big Board</h2></div><span class="aside">${board.length} of ${N.bigBoard.length}</span></header>
        ${chipRow('bb', bbView, [['scorers', 'Scores in Blitz'], ['off', 'Offense'], ['idp', 'IDP'], ['all', 'All 50']])}
        ${board.length ? `<div class="nw-board">${board.map(b => `<details class="nw-pro${BLITZ_POS[b.pos] ? '' : ' none'}"><summary>
            <span class="nw-prk">${b.rank}</span><span class="nw-pname"><b>${esc(b.name)}</b><small>${esc(b.pos || '')}${b.posRank ? ` ${esc(b.pos)}${b.posRank}` : ''} · ${esc(b.school || '')}${b.ht ? ` · ${esc(b.ht)}, ${esc(b.wt || '')}` : ''}</small></span>
            ${BLITZ_POS[b.pos] ? `<span class="nw-slot">${esc(BLITZ_POS[b.pos])}</span>` : '<span class="nw-slot off">No Blitz slot</span>'}</summary>
            <div class="nw-pbody">${statLine(b)}${b.note ? `<p>${esc(b.note)}</p>` : ''}${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">ESPN scouting and stats &rsaquo;</a>` : ''}</div></details>`).join('')}</div>`
          : `<div class="empty">ESPN hasn't published a ${esc(N.draftYear || '')} board yet.</div>`}
        <p class="footnote">Rankings, scouting notes and college stats are ESPN's (${esc(N.season)} college season). Tap a prospect for his stats and ESPN's note. "Scores in Blitz" hides positions with no Blitz lineup slot (offensive line, punters, long snappers).</p></section>
      <section class="panel s12"><header><div><span class="eyebrow">College football week ${esc(C.week || '')} · each game's leader</span><h2>College watch</h2></div></header>
        <div class="nw-cfb">${LEAD.map(([k, l]) => `<div><div class="sub">${l}</div>${(C.leaders[k] || []).slice(0, 8).map((x, i) => `<div class="nw-clead"><span class="rk">${i + 1}</span>
          <span class="nw-pname"><b>${esc(x.name)}</b><small>${esc(x.pos || '')} · ${x.rank && x.rank <= 25 ? `#${x.rank} ` : ''}${esc(x.team || '')} vs ${esc(x.opp || '')}</small></span><span class="nw-cline">${esc(x.line || '')}</span>${tagBoard(onBoard.get(x.cid))}</div>`).join('') || '<div class="empty">No finished games.</div>'}</div>`).join('')}</div>
        <div class="sub">College headlines</div>
        ${cnews.length ? `<div class="nw-list compact">${cnews.slice(0, 10).map(citem).join('')}</div>${cnews.length > 10 ? `<details class="nw-reveal"><summary>${cnews.length - 10} more</summary><div class="nw-list compact">${cnews.slice(10).map(citem).join('')}</div></details>` : ''}` : '<div class="empty">No college headlines.</div>'}
        <p class="footnote">Leaders and headlines from ESPN, as of ${ago(N.built)}. Stories naming a Big Board prospect come first.</p></section>
    </div>`;
  }

  // ---------- Players: every NFL player's season so far, in Blitz League scoring ----------
  const PL = { q: '', pos: 'all', own: 'all', sort: 'ppg', limit: 50 };
  const PL_POS = ['all', 'QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB'];
  function playerRows() {
    return Object.entries(N.players || {}).filter(([id]) => M.players[id]).map(([id, v]) => ({ id, p: P(id), gp: v[0], tot: v[1], ppg: v[1] / (v[0] || 1), l3: v[2], owner: N.owner(id), proj: N.proj[id] ? N.proj[id][0] : null }));
  }
  function playerList() {
    const q = NFL.norm(PL.q || '');
    let rows = playerRows().filter(r => (PL.pos === 'all' || r.p.position === PL.pos) && (PL.own === 'all' || (PL.own === 'fa' ? !r.owner : !!r.owner))
      && (!q || NFL.norm(r.p.full_name || '').includes(q) || NFL.norm(N.teamOf(r.id) || '') === q));
    // Points per game needs a few games to mean much; unless you're searching, it leaves out players with fewer than 3.
    if (PL.sort === 'ppg' && !q) rows = rows.filter(r => r.gp >= 3);
    const key = { ppg: r => r.ppg, tot: r => r.tot, l3: r => r.l3, proj: r => (r.proj == null ? -1 : r.proj) }[PL.sort];
    rows.sort((a, b) => key(b) - key(a));
    const shown = rows.slice(0, PL.limit);
    const th = (k, label) => `<th class="num"><button class="nw-th${PL.sort === k ? ' on' : ''}" data-pl-sort="${k}">${label}${PL.sort === k ? ' ▼' : ''}</button></th>`;
    return rows.length ? `<div class="tablewrap"><table class="nw-rk nw-pl"><thead><tr><th>#</th><th>Player</th><th class="num">GP</th>${th('tot', 'Total')}${th('ppg', 'Pts/G')}${th('l3', 'Last 3')}${th('proj', 'Proj')}<th>Blitz</th></tr></thead>
      <tbody>${shown.map((r, i) => `<tr><td class="rk">${i + 1}</td><td>${who(r.id)} ${UI.status(r.p)}</td><td class="num">${r.gp}</td><td class="num">${f1(r.tot)}</td><td class="num strong">${f1(r.ppg)}</td>
        <td class="num">${f1(r.l3)}</td><td class="num">${r.proj != null ? f1(r.proj) : '-'}</td><td>${r.owner ? own(r.owner, true) : '<span class="nw-fa">Free agent</span>'}</td></tr>`).join('')}</tbody></table></div>
      ${rows.length > PL.limit ? `<div class="acct-row"><button class="btn" data-pl-more="1">Show more (${rows.length - PL.limit} left)</button></div>` : ''}`
      : '<div class="empty">No players match.</div>';
  }
  function players() {
    const chip = (attr, v, label, cur) => `<button data-${attr}="${v}" aria-pressed="${cur === v}">${label}</button>`;
    return `<div class="grid"><section class="panel s12"><header><div><span class="eyebrow">Every NFL player · ${esc(String(N.season || ''))} season · Blitz League scoring</span><h2>Players</h2></div></header>
      <div class="acct-row"><input id="pl-q" type="search" placeholder="Search a player or NFL team (e.g. KC)" value="${esc(PL.q)}" autocomplete="off"></div>
      <div class="nw-filter">${PL_POS.map(x => chip('pl-pos', x, x === 'all' ? 'All' : x, PL.pos)).join('')}</div>
      <div class="nw-filter">${chip('pl-own', 'all', 'Everyone', PL.own)}${chip('pl-own', 'fa', 'Free agents', PL.own)}${chip('pl-own', 'owned', 'On a Blitz team', PL.own)}</div>
      <div id="pl-list">${playerList()}</div>
      <p class="footnote">Points are this season's games scored with The Blitz League's own settings${N.built ? `, as of ${ago(N.built)}` : ''}. Pts/G lists players with 3+ games unless you search. Proj is Sleeper's projection for this week. Tap a player for his card.</p></section></div>`;
  }

  const VIEWS = { headlines, players, injuries, matchups, defenses, slate, trending, rookies };
  function route() {
    const h = location.hash.slice(1), cur = VIEWS[h] ? h : 'headlines';
    document.getElementById('tabs').innerHTML = tabsHTML(TABS, cur);
    document.getElementById('content').innerHTML = VIEWS[cur]() + `<p class="footnote nw-source">${source()}. Headlines link to ESPN.</p>`;
    paintHelmets(document).catch(() => {});
  }

  boot('League · <strong>Blitz Network</strong>', async m => {
    M = m;
    N = await NFL.load(M, live => { N = live; hero(); route(); });
    hero();
    route();
    addEventListener('hashchange', route);
    // Players tab: filters and sorting redraw only the list, so the search box keeps its focus.
    const plRedraw = () => { const el = document.getElementById('pl-list'); if (el) { el.innerHTML = playerList(); paintHelmets(el).catch(() => {}); } };
    document.addEventListener('input', e => { if (e.target.id === 'pl-q') { PL.q = e.target.value; PL.limit = 50; plRedraw(); } });
    document.addEventListener('click', e => {
      const pb = e.target.closest('[data-pl-pos], [data-pl-own], [data-pl-sort], [data-pl-more]');
      if (pb) {
        if (pb.dataset.plPos) PL.pos = pb.dataset.plPos;
        if (pb.dataset.plOwn) PL.own = pb.dataset.plOwn;
        if (pb.dataset.plSort) PL.sort = pb.dataset.plSort;
        PL.limit = pb.dataset.plMore ? PL.limit + 50 : 50;
        for (const g of document.querySelectorAll('[data-pl-pos], [data-pl-own]')) g.setAttribute('aria-pressed', String(g.dataset.plPos ? g.dataset.plPos === PL.pos : g.dataset.plOwn === PL.own));
        plRedraw(); return;
      }
      const b = e.target.closest('[data-sort], [data-rk], [data-bb]'); if (!b) return;
      if (b.dataset.sort != null) sortBy = b.dataset.sort || null;
      if (b.dataset.rk) rkView = b.dataset.rk;
      if (b.dataset.bb) bbView = b.dataset.bb;
      route();
    });
  });
  function hero() {
    const net = M.league.network || {};
    document.getElementById('hero').innerHTML = `<section class="lhero nhero"><div class="wrap">
      ${net.logo ? `<img class="nhero-logo" src="${esc(net.logo)}" alt="${esc(net.name || 'Blitz Network')}">` : ''}
      <div><span class="eyebrow">NFL week ${esc(N.week)} · ${N.news.length} headlines · ${N.starters.length} Blitz starters in action</span><h1>${esc(net.name || 'Blitz Network')}</h1>
        <div class="nick">Real NFL news, injuries and matchups, read through every Blitz roster</div></div></div></section>`;
  }
})();
