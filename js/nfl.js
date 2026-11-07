/* The real-NFL side of the Blitz Network: headlines, this week's NFL slate, the injury report, points allowed by
   each defense, projections and Sleeper's trending players, all tied back to Blitz League rosters.

   Sources (see tools/build_nfl.py for the full notes):
   - ESPN's public site API (site.api.espn.com): news, scoreboard, injuries. Asked for live; data/nfl.json if that fails.
   - Sleeper: trending adds/drops (asked for live), and in data/nfl.json, points allowed by position and projections,
     both scored with the Blitz League's own scoring settings.
   Headlines and ESPN's one-line injury notes are shown as ESPN wrote them, credited and linked to ESPN. Nothing is
   written here that the data doesn't say. */
(function () {
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
  const SLEEPER = 'https://api.sleeper.app/v1';
  const ABBR = { WSH: 'WAS' };
  const ab = a => ABBR[a] || a;
  const OFF = ['QB', 'RB', 'WR', 'TE', 'K'], IDP = ['DL', 'LB', 'DB'], POS = [...OFF, ...IDP];

  const timed = (url, ms = 6000) => {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    return fetch(url, { signal: c.signal }).then(r => { clearTimeout(t); if (!r.ok) throw new Error(r.status); return r.json(); });
  };

  // ---------- ESPN responses -> the same shapes tools/build_nfl.py writes ----------
  function slate(sb) {
    const teamById = {}, games = [];
    for (const e of sb.events || []) {
      const c = e.competitions[0], side = {};
      for (const t of c.competitors) {
        teamById[t.team.id] = ab(t.team.abbreviation);
        const rec = ((t.records || []).find(r => r.type === 'total') || {}).summary || '';
        side[t.homeAway] = { abbr: ab(t.team.abbreviation), name: t.team.displayName || '', short: t.team.shortDisplayName || '', rec, score: t.score, winner: !!t.winner };
      }
      const odds = (c.odds || [])[0] || {}, st = e.status.type;
      const recap = ((c.headlines || []).find(h => h.shortLinkText) || {}).shortLinkText || null;
      games.push({ id: e.id, at: e.date, state: st.state, detail: st.shortDetail, net: (c.broadcasts || []).flatMap(b => b.names || []).join(', '),
        home: side.home, away: side.away, neutral: !!c.neutralSite, venue: (c.venue || {}).fullName, line: odds.details || null, ou: odds.overUnder ?? null, recap });
    }
    const byes = ((sb.week || {}).teamsOnBye || []).map(t => (teamById[t.id] = ab(t.abbreviation)));
    return { games, byes, teamById, week: (sb.week || {}).number };
  }
  const story = (a, teamById) => {
    const cats = a.categories || [];
    return { id: a.id, at: a.published, type: a.type, head: a.headline || '', dek: a.description || '', url: ((a.links || {}).web || {}).href,
      byline: a.byline, premium: !!a.premium,
      athletes: cats.filter(c => c.type === 'athlete' && c.description).map(c => c.description),
      teams: [...new Set(cats.filter(c => c.type === 'team' && teamById[String(c.teamId)]).map(c => teamById[String(c.teamId)]))].sort() };
  };
  const hurt = inj => (inj.injuries || []).flatMap(t => (t.injuries || []).filter(x => x.status && x.status !== 'Active').map(x => {
    const a = x.athlete || {};
    return { name: a.displayName, team: ab((a.team || {}).abbreviation || '') || null, pos: (a.position || {}).abbreviation, status: x.status, note: x.shortComment, at: x.date };
  }));

  // ---------- names -> Sleeper player IDs ----------
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.'’`-]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();
  function nameIndex(players) {
    const ix = new Map();
    for (const [id, p] of Object.entries(players)) {
      if (!p.full_name || p.position === 'DEF') continue;
      const k = norm(p.full_name);
      (ix.get(k) || ix.set(k, []).get(k)).push(id);
    }
    return ix;
  }
  // One clear match, or the one on the NFL team ESPN named; never a guess between two players.
  function resolve(ix, players, name, teams) {
    const ids = ix.get(norm(name)) || [];
    if (ids.length === 1) return ids[0];
    const on = ids.filter(id => teams && teams.includes(players[id].team));
    return on.length === 1 ? on[0] : null;
  }

  // ---------- Blitz rosters ----------
  function owners(M) {
    const own = {};
    for (const t of Object.values(M.teams)) {
      const r = t.roster, g = t.games.find(x => x.week === M.current);
      const starters = new Set(((g && g.me.starters) || r.starters || []).filter(x => x && x !== '0'));
      const put = (ids, where) => (ids || []).forEach(id => { if (!own[id]) own[id] = { t, where: starters.has(id) ? 'starter' : where }; });
      put([...starters], 'starter'); put(r.reserve, 'IR'); put(r.taxi, 'taxi'); put(r.players, 'bench');
    }
    return own;
  }

  const group = p => (p && (POS.includes(p.position) ? p.position : null));

  async function load(M) {
    const snap = await fetch('data/nfl.json').then(r => (r.ok ? r.json() : null)).catch(() => null) || {};
    const [sb, news, inj, add, drop] = await Promise.all([
      timed(`${ESPN}/scoreboard`).catch(() => null), timed(`${ESPN}/news?limit=50`).catch(() => null), timed(`${ESPN}/injuries`, 9000).catch(() => null),
      timed(`${SLEEPER}/players/nfl/trending/add?lookback_hours=24&limit=25`).catch(() => null),
      timed(`${SLEEPER}/players/nfl/trending/drop?lookback_hours=24&limit=25`).catch(() => null)]);
    const live = {};
    let s = { games: snap.games || [], byes: snap.byes || [], teamById: {}, week: snap.week };
    if (sb && sb.events) { s = slate(sb); live.games = true; }
    const N = {
      season: snap.season, week: s.week || snap.week, built: snap.built, dvpThrough: snap.dvpThrough, scoring: snap.scoring,
      games: s.games, byes: s.byes,
      news: news && news.articles ? (live.news = true, news.articles.map(a => story(a, s.teamById))) : snap.news || [],
      injuries: inj && inj.injuries ? (live.injuries = true, hurt(inj)) : snap.injuries || [],
      trending: add && drop ? (live.trending = true, { add, drop }) : snap.trending || { add: [], drop: [] },
      dvp: snap.dvp || {}, proj: snap.proj || {}, live,
    };
    // The snapshot's projections are for one NFL week; never show them against a different one.
    if (snap.week !== N.week) N.proj = {};

    const P = M.players, ix = nameIndex(P), own = owners(M);
    N.owner = id => own[id] || null;
    N.teamOf = id => (N.proj[id] && N.proj[id][2]) || (P[id] && P[id].team) || null;
    const opp = {};
    for (const g of N.games) if (g.home && g.away) { opp[g.home.abbr] = { vs: g.away.abbr, home: true, g }; opp[g.away.abbr] = { vs: g.home.abbr, home: false, g }; }
    N.gameOf = abbr => opp[abbr] || null;

    for (const n of N.news) {
      n.pids = [...new Set(n.athletes.map(a => resolve(ix, P, a, n.teams)).filter(Boolean))];
      n.blitz = n.pids.filter(id => own[id]).map(id => ({ id, ...own[id] }));
    }
    for (const x of N.injuries) { x.pid = resolve(ix, P, x.name, x.team ? [x.team] : null); x.own = x.pid && own[x.pid]; }

    // Every Blitz starter this week, with their NFL game and how that defense treats their position.
    N.starters = Object.entries(own).filter(([, o]) => o.where === 'starter').map(([id, o]) => {
      const p = P[id] || {}, pos = group(p), team = N.teamOf(id), gm = team && opp[team];
      const d = gm && N.dvp[gm.vs], pj = N.proj[id];
      return { id, ...o, p, pos, team, game: gm, bye: N.byes.includes(team),
        allow: d && pos ? d[pos] : null, rank: d && pos && d.rank ? d.rank[pos] : null, proj: pj ? pj[0] : null };
    });
    return N;
  }

  window.NFL = { load, POS, OFF, IDP, norm };
})();
