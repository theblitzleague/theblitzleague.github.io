/* Data layer. Loads the commissioner's branding files, then Sleeper data:
   - sample mode (league.json sleeperLeagueId is null): data/sample/*.json
   - live mode: Sleeper's public read-only API, plus data/players.json
     (a trimmed copy of Sleeper's ~15MB player database, built by tools/build_players.py;
     never fetch the full database from a visitor's browser).
   Everything is normalized into one model so the pages don't care which mode is on. */
(function () {
  const API = 'https://api.sleeper.app/v1';
  const getJSON = async url => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} returned ${r.status}`);
    return r.json();
  };

  // The League's scoring: the Hub's own settings (data/scoring.json), used in every mode.
  const hubScoring = () => getJSON('data/scoring.json').then(x => x.settings || null).catch(() => null);
  async function loadSample() {
    const names = ['rosters', 'users', 'matchups', 'transactions', 'traded_picks', 'players', 'state'];
    const [got, scoring] = await Promise.all([Promise.all(names.map(n => getJSON(`data/sample/${n}.json`))), hubScoring()]);
    const d = Object.fromEntries(names.map((n, i) => [n, got[i]]));
    return { ...d, rosterPositions: null, drafts: [], scoring };
  }

  // Untested until a real league ID exists.
  async function loadLive(id, weeks) {
    const [league, rosters, users, traded_picks, state, players] = await Promise.all([
      getJSON(`${API}/league/${id}`), getJSON(`${API}/league/${id}/rosters`),
      getJSON(`${API}/league/${id}/users`), getJSON(`${API}/league/${id}/traded_picks`),
      getJSON(`${API}/state/nfl`), getJSON('data/players.json')]);
    const wk = Array.from({ length: weeks }, (_, i) => i + 1);
    const m = await Promise.all(wk.map(w => getJSON(`${API}/league/${id}/matchups/${w}`)));
    const t = await Promise.all(wk.map(w => getJSON(`${API}/league/${id}/transactions/${w}`)));
    return {
      rosters, users, traded_picks, state, players,
      matchups: Object.fromEntries(wk.map((w, i) => [String(w), m[i]])),
      transactions: t.flat().filter(x => x.status === 'complete'),
      rosterPositions: (league.roster_positions || []).filter(p => !['BN', 'IR', 'TAXI'].includes(p)),
      playoffTeams: league.settings && league.settings.playoff_teams,
      scoring: (await hubScoring()) || league.scoring_settings || null,
      drafts: await loadDrafts(id),
    };
  }

  // Past and upcoming drafts with their picks. Untested until a real league ID exists.
  async function loadDrafts(id) {
    const drafts = await getJSON(`${API}/league/${id}/drafts`);
    return Promise.all(drafts.map(async d => ({ ...d, picks: d.status === 'complete' || d.status === 'drafting' ? await getJSON(`${API}/draft/${d.draft_id}/picks`) : [] })));
  }

  // The Hub's own league rosters (league/rosters in Firestore), written when the commissioner marks a Draft Room draft
  // official. Public read through Firestore's REST endpoint, so no sign-in is needed. While the preview league is on,
  // those rosters replace the placeholder ones: every page (teams, player cards, the Network) then shows who drafted
  // whom. Past weeks keep their placeholder scores; this week's and later lineups start empty until Hub lineups exist.
  // Any Firestore REST value -> plain JS.
  const val = x => (x == null || 'nullValue' in x ? null : 'stringValue' in x ? x.stringValue : 'integerValue' in x ? +x.integerValue : 'doubleValue' in x ? x.doubleValue
    : 'booleanValue' in x ? x.booleanValue : 'arrayValue' in x ? (x.arrayValue.values || []).map(val) : 'mapValue' in x ? Object.fromEntries(Object.entries(x.mapValue.fields || {}).map(([k, y]) => [k, val(y)])) : null);
  // Firestore REST map of arrays ({team: [ids]}) -> plain object; nulls stay null (an empty lineup spot).
  const lists = m => { const o = {}; for (const [k, v] of Object.entries((m && m.mapValue && m.mapValue.fields) || {})) o[k] = ((v.arrayValue || {}).values || []).map(x => ('stringValue' in x ? x.stringValue : null)); return o; };
  // One request for the whole league/ folder (rosters, lineups, waivers, FAAB, picks), plus the week results and the
  // transactions: lists answer even when a document doesn't exist yet, so nothing shows up as an error.
  async function hubRosters() {
    const c = window.FIREBASE_CONFIG; if (!c) return null;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    const list = path => fetch(`https://firestore.googleapis.com/v1/projects/${c.projectId}/databases/(default)/documents/${path}&key=${c.apiKey}`, { signal: ctl.signal })
      .then(x => (x.ok ? x.json() : {})).catch(() => ({}));
    try {
      const [lg, res, txs] = await Promise.all([list('league?pageSize=20'), list('results?pageSize=60'), list('transactions?pageSize=300')]);
      const D = {}; for (const d of lg.documents || []) D[d.name.split('/').pop()] = d.fields || {};
      const f = D.rosters; if (!f) return null;
      const obj = k => val({ mapValue: { fields: D[k] || {} } }) || {};
      return { source: f.source && f.source.stringValue, name: f.name && f.name.stringValue, at: +((f.at && (f.at.integerValue || f.at.doubleValue)) || 0),
        rosters: lists(f.rosters), ir: lists(f.ir), taxi: lists(f.taxi), lineups: lists((D.lineups || {}).teams), startWeek: f.startWeek ? val(f.startWeek) : null,
        results: (res.documents || []).map(d => val({ mapValue: { fields: d.fields } })),
        waivers: obj('waivers').players || {}, faab: obj('faab'), picks: obj('picks').traded || [], bracket: D.bracket ? obj('bracket') : null,
        transactions: (txs.documents || []).map(d => ({ transaction_id: d.name.split('/').pop(), ...val({ mapValue: { fields: d.fields } }) })) };
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  async function applyHub(raw, hub) {
    const [all, nfl] = await Promise.all([getJSON('data/players.json').catch(() => ({})), getJSON('data/nfl.json').catch(() => ({}))]);
    raw.seasonStats = nfl.players || {};            // {id: [games, points, last-3 average]} in League scoring
    for (const [id, p] of Object.entries(all)) if (!raw.players[id]) raw.players[id] = p;
    // Lineups are the Hub's standing lineup (league/lineups), in league.json rosterSlots order; null = an empty spot.
    for (const r of raw.rosters) {
      const k = String(r.roster_id), all = hub.rosters[k] || [];
      r.players = all; r.reserve = (hub.ir[k] || []).filter(id => all.includes(id)); r.taxi = (hub.taxi[k] || []).filter(id => all.includes(id));
      r.starters = (hub.lineups[k] || []).map(id => (id && all.includes(id) && !r.reserve.includes(id) && !r.taxi.includes(id) ? id : '0'));
    }
    const wk = raw.state.week;
    // Weeks before startWeek (the first week the official rosters could set a lineup before kickoff) stay placeholder
    // weeks, scores and all. Until the server records startWeek, rosters made official mid-week start next week.
    const start = hub.startWeek || wk + 1;
    raw.hubStart = start;
    for (const [w, rows] of Object.entries(raw.matchups)) if (+w >= wk) for (const m of rows) {
      if (+w < start) continue;
      const r = raw.rosters.find(x => x.roster_id === m.roster_id);
      m.starters = +w === wk && r ? r.starters.slice() : []; m.starters_points = m.starters.map(() => 0); m.players = r ? r.players.slice() : []; m.points = 0;
    }
    // Weeks the Hub has scored (results/{season}-w{week}, functions/index.js weekResults) replace the placeholder scores.
    for (const R of hub.results || []) {
      if (String(R.season) !== String(raw.state.season) || !(R.week < wk || (R.week === wk && R.final))) continue;
      for (const m of raw.matchups[String(R.week)] || []) {
        const x = (R.teams || {})[String(m.roster_id)]; if (!x) continue;
        m.starters = (x.starters || []).map(id => id || '0'); m.starters_points = x.points || []; m.points = x.pts || 0;
      }
    }
    // Playoff games (weeks 15-17) from the bracket (league/bracket): each side's lineup and points come from that week's
    // results once scored, otherwise from the team's current lineup (scored live by applyLive during the week).
    if (hub.bracket && hub.bracket.rounds) for (const rd of hub.bracket.rounds) {
      const R = (hub.results || []).find(x => String(x.season) === String(raw.state.season) && x.week === rd.week);
      const rows = []; let mid = 0;
      for (const g of rd.games) {
        if (!g.a || !g.b) continue; mid++;
        for (const t of [g.a, g.b]) {
          const x = R && R.teams && R.teams[String(t)], r = raw.rosters.find(y => y.roster_id === t);
          const starters = x ? (x.starters || []).map(id => id || '0') : rd.week >= wk && r ? r.starters.slice() : [];
          rows.push({ roster_id: t, matchup_id: mid, starters, starters_points: x ? x.points || [] : starters.map(() => 0), points: x ? x.pts || 0 : 0, players: r ? r.players.slice() : [], label: g.label, seed: t === g.a ? g.aSeed : g.bSeed });
        }
      }
      if (rows.length) (raw.playoffs = raw.playoffs || {})[String(rd.week)] = rows;
    }
    raw.deriveRecords = true;
    raw.transactions = hub.transactions || [];          // the Hub league's own adds, drops, claims and trades
    raw.traded_picks = hub.picks || [];                 // and its own pick trades (league/picks)
  }

  const pts = (whole, dec) => (whole || 0) + (dec || 0) / 100;

  // Sleeper lists defenders by exact spot (DE, CB, OLB...); lineups use DL / LB / DB. Every page groups by
  // `position`, so it becomes the lineup group; the exact spot is kept as `nflPos` for the player card.
  const IDP = { DE: 'DL', DT: 'DL', NT: 'DL', ILB: 'LB', OLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB' };
  const KEEP = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
  function normalize(players) {
    for (const [id, p] of Object.entries(players)) {
      p._id = id;                                   // lets an injury badge find its player again (js/ui.js status)
      if (KEEP.includes(p.position)) continue;
      const g = (p.fantasy_positions || []).find(x => ['DL', 'LB', 'DB'].includes(x)) || IDP[p.position];
      if (g) { p.nflPos = p.position; p.position = g; }
    }
    return players;
  }

  // A GM's identity: their Sleeper user ID (live: the roster owner; otherwise franchises.json), so honors and
  // career numbers follow the person from franchise to franchise. Falls back to the name before IDs exist.
  const gmKey = (r, f) => r.owner_id || (f.gm && (f.gm.sleeperUserId || (f.gm.name && `name:${f.gm.name}`))) || null;

  // Highest score of each final regular-season week; a tie shares it. Pays the weekly prize.
  function weeklyHighs(teams, league) {
    const byWeek = {};
    for (const t of Object.values(teams)) for (const g of t.games)
      if (g.final && g.week <= league.regularSeasonWeeks) (byWeek[g.week] = byWeek[g.week] || []).push({ t, p: g.me.points });
    return Object.keys(byWeek).map(Number).sort((a, b) => a - b).map(w => {
      const rows = byWeek[w], hi = Math.max(...rows.map(r => r.p));
      return { week: w, points: hi, winners: rows.filter(r => r.p === hi).map(r => r.t) };
    });
  }

  // Prize money one completed season paid, per roster, at that season's own amounts (history.json keeps a copy, so
  // changing league.json later never rewrites the past). Ties split a prize. Kinds: champion, runnerUp, third, division,
  // weekly, pointsLeader, gmOfYear (the vote, entered by hand in history.json).
  function payouts(s, z) {
    const out = [], add = (rid, kind, amount, week) => amount && out.push({ rid: +rid, kind, amount, week });
    if (s.champion != null) add(s.champion, 'champion', z.champion);
    if (s.runnerUp != null) add(s.runnerUp, 'runnerUp', z.runnerUp);
    if (s.third != null) add(s.third, 'third', z.third);
    (s.divisionWinners || []).forEach(r => add(r, 'division', z.division));
    (s.weeklyHigh || []).forEach(w => w.rosters.forEach(r => add(r, 'weekly', (z.weekly || 0) / w.rosters.length, w.week)));
    (s.pointsLeader || []).forEach((r, _, a) => add(r, 'pointsLeader', (z.pointsLeader || 0) / a.length));
    if (s.gmOfYear != null) add(s.gmOfYear, 'gmOfYear', z.gmOfYear);
    return out;
  }

  // Careers (per GM, every franchise they ran) and franchise honors, from data/history.json plus this season.
  // Earnings: everything paid in completed seasons, plus this season's weekly prizes already won.
  function honors(teams, history, state, league, weekly) {
    const seasons = (history && history.seasons) || [];
    const careers = {};
    const C = k => careers[k] || (careers[k] = { key: k, name: null, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, seasons: 0, titles: [], divs: [], runnerUps: [], poW: 0, poL: 0, earnings: [], won: 0, teams: new Set() });
    const pay = (c, e) => { c.earnings.push(e); c.won += e.amount; };
    for (const t of Object.values(teams)) { t.titles = []; t.divTitles = []; t.runnerUps = []; }
    for (const s of seasons) {
      for (const [rid, e] of Object.entries(s.teams || {})) {
        const id = +rid, t = teams[id], won = s.champion === id, div = (s.divisionWinners || []).includes(id);
        if (t) { if (won) t.titles.push(s.season); if (div) t.divTitles.push({ season: s.season, division: e.division }); if (s.runnerUp === id) t.runnerUps.push(s.season); }
        if (!e.gm) continue;
        const c = C(e.gm);
        if (e.gmName) c.name = e.gmName;
        c.wins += e.wins || 0; c.losses += e.losses || 0; c.ties += e.ties || 0; c.pf += e.pf || 0; c.pa += e.pa || 0; c.seasons++; c.teams.add(id);
        if (won) c.titles.push({ season: s.season, rid: id });
        if (s.runnerUp === id) c.runnerUps.push({ season: s.season, rid: id });    // lost the Blitz Bowl
        c.poW += e.playoffWins || 0; c.poL += e.playoffLosses || 0;                // playoff games (history.json, optional)
        if (div) c.divs.push({ season: s.season, rid: id, division: e.division });
      }
      for (const p of payouts(s, s.prizes || league.prizes || {})) {
        const e = (s.teams || {})[p.rid];
        if (e && e.gm) pay(C(e.gm), { season: s.season, ...p });
      }
    }
    if (!seasons.some(s => s.season === state.season)) {        // the season in progress counts toward record and points
      for (const t of Object.values(teams)) {
        if (!t.gmKey) continue;
        const c = C(t.gmKey);
        if (t.f.gm && t.f.gm.name) c.name = t.f.gm.name;
        c.wins += t.wins; c.losses += t.losses; c.ties += t.ties; c.pf += t.pf; c.pa += t.pa; c.seasons++; c.teams.add(t.id); c.current = true;
      }
      const per = (league.prizes || {}).weekly || 0;
      for (const w of weekly) for (const t of w.winners)
        if (t.gmKey && per) pay(C(t.gmKey), { season: state.season, rid: t.id, kind: 'weekly', amount: per / w.winners.length, week: w.week, current: true });
    }
    for (const t of Object.values(teams)) if (t.gmKey && careers[t.gmKey]) careers[t.gmKey].rid = t.id;   // the franchise they run now
    return { careers, seasons };
  }

  function build(league, brand, raw) {
    const divById = Object.fromEntries(league.divisions.map(d => [d.id, d]));
    const divByKey = Object.fromEntries(league.divisions.map(d => [d.key, d]));
    const current = raw.state.week;
    const teams = {};
    for (const r of raw.rosters) {
      const f = brand.franchises[String(r.roster_id)];
      if (!f) throw new Error(`franchises.json has no entry for roster_id ${r.roster_id}`);
      const s = r.settings || {};
      teams[r.roster_id] = {
        id: r.roster_id, f, roster: r, gmKey: gmKey(r, f),
        owner: raw.users.find(u => u.user_id === r.owner_id) || null,
        division: divById[s.division] || divByKey[f.division],
        wins: s.wins || 0, losses: s.losses || 0, ties: s.ties || 0,
        pf: pts(s.fpts, s.fpts_decimal), pa: pts(s.fpts_against, s.fpts_against_decimal),
      };
    }
    for (const t of Object.values(teams)) {
      t.games = [];
      for (let w = 1; w <= league.regularSeasonWeeks; w++) {
        const rows = raw.matchups[String(w)] || [];
        const me = rows.find(x => x.roster_id === t.id);
        if (!me || me.matchup_id == null) continue;
        const opp = rows.find(x => x.matchup_id === me.matchup_id && x.roster_id !== t.id);
        const final = w < current;
        const g = { week: w, me, opp: opp && teams[opp.roster_id], oppRow: opp, final, live: w === current };
        if (final && opp) g.result = me.points > opp.points ? 'W' : me.points < opp.points ? 'L' : 'T';
        t.games.push(g);
      }
      // Playoff games live apart from the regular season (t.playoffGames), so records, streaks and prizes never count them.
      t.playoffGames = [];
      for (const [w, rows] of Object.entries(raw.playoffs || {})) {
        const me = rows.find(x => x.roster_id === t.id); if (!me) continue;
        const opp = rows.find(x => x.matchup_id === me.matchup_id && x.roster_id !== t.id), final = +w < current;
        const g = { week: +w, me, opp: opp && teams[opp.roster_id], oppRow: opp, final, live: +w === current, playoff: true, label: me.label };
        if (final && opp) g.result = me.points > opp.points ? 'W' : me.points < opp.points ? 'L' : (me.seed < opp.seed ? 'W' : 'L');
        t.playoffGames.push(g);
      }
      const done = t.games.filter(g => g.final);
      let streak = '';
      for (let i = done.length - 1; i >= 0; i--) {
        if (!streak) streak = done[i].result + '1';
        else if (done[i].result === streak[0]) streak = streak[0] + (+streak.slice(1) + 1);
        else break;
      }
      t.streak = streak || '-';
      t.divRecord = done.filter(g => g.opp && g.opp.division === t.division)
        .reduce((a, g) => (a[g.result === 'W' ? 0 : 1]++, a), [0, 0]);
      const scores = done.map(g => g.me.points);
      t.high = scores.length ? Math.max(...scores) : 0;
      t.low = scores.length ? Math.min(...scores) : 0;
    }
    // Hub league: records come from the games themselves (placeholder weeks plus the weeks the Hub scored), not from
    // the placeholder roster settings.
    if (raw.deriveRecords) for (const t of Object.values(teams)) {
      const done = t.games.filter(g => g.final && g.opp);
      t.wins = done.filter(g => g.result === 'W').length; t.losses = done.filter(g => g.result === 'L').length; t.ties = done.filter(g => g.result === 'T').length;
      t.pf = Math.round(done.reduce((a, g) => a + (g.me.points || 0), 0) * 100) / 100; t.pa = Math.round(done.reduce((a, g) => a + ((g.oppRow && g.oppRow.points) || 0), 0) * 100) / 100;
    }
    // Division standings: wins, then points for.
    const order = (a, b) => (b.wins - a.wins) || (b.pf - a.pf);
    for (const d of league.divisions) {
      Object.values(teams).filter(t => t.division === d).sort(order).forEach((t, i) => (t.divRank = i + 1));
    }
    Object.values(teams).sort(order).forEach((t, i) => (t.leagueRank = i + 1));
    const weekly = weeklyHighs(teams, league);
    const { careers, seasons: history } = honors(teams, raw.history, raw.state, league, weekly);
    // Player awards from completed seasons, by player: [{award, season, rid, points}], oldest first.
    const playerHonors = {};
    for (const s of (raw.history && raw.history.seasons) || [])
      for (const [award, list] of Object.entries(s.playerAwards || {}))
        for (const w of list || []) if (w && w.player) (playerHonors[w.player] = playerHonors[w.player] || []).push({ award, season: s.season, rid: w.roster, points: w.points });
    return {
      careers, history, weekly,
      league, teams, players: normalize(raw.players), state: raw.state, current, playerHonors,
      transactions: raw.transactions.slice().sort((a, b) => b.created - a.created),
      tradedPicks: raw.traded_picks,
      drafts: raw.drafts || [],
      slots: raw.rosterPositions && raw.rosterPositions.length ? raw.rosterPositions : league.rosterSlots,
      playoffTeams: raw.playoffTeams || league.playoffTeams || 6,
      scoring: raw.scoring || null,
    };
  }

  // Live Hub matchups: this week's starters scored from live/current (functions/index.js liveScores, every 2 minutes
  // during games). A starter whose NFL game hasn't kicked off gets null (shown as "-"); one whose game has started but
  // has no stats yet gets 0. Each side's points = the sum of its starters. Only for the Hub's own rosters (M.hub).
  function applyLive(M, L) {
    if (!M.hub || !L || !L.players || +L.week !== +M.current || +M.current < +(M.hubStart || 0)) return false;
    const started = team => { const g = (L.games || []).find(x => x.away.abbr === team || x.home.abbr === team); return !!g && g.state !== 'pre'; };
    const seen = new Set();
    for (const t of Object.values(M.teams)) {
      const g = t.games.find(x => x.week === M.current) || (t.playoffGames || []).find(x => x.week === M.current); if (!g) continue;
      for (const row of [g.me, g.oppRow]) {
        if (!row || seen.has(row)) continue; seen.add(row);
        row.starters_points = (row.starters || []).map(pid => {
          if (!pid || pid === '0') return 0;
          const v = L.players[pid]; if (v) return v[0];
          const p = M.players[pid]; return p && started(p.team) ? 0 : null;
        });
        row.points = Math.round(row.starters_points.reduce((a, b) => a + (b || 0), 0) * 100) / 100;
      }
    }
    M.liveAt = L.updated; M.liveScoring = true;
    return true;
  }

  window.Hub = {
    applyLive,
    // Fetch the newest live points and apply them (pages that stay open during games call this every minute or so).
    async liveRefresh(M) { return window.NFL ? applyLive(M, await NFL.liveScores(true)) : false; },
    // One load per page: the page and the player card share it.
    load() {
      // Injury badges start from data/players.json (rebuilt nightly) and are then corrected from ESPN's live injury
      // report by js/nfl.js, without holding the page back.
      return this._p || (this._p = this._load().then(M => { if (window.NFL) NFL.overlay(M).catch(e => console.error(e)); return M; }));
    },
    // ESPN's live injury report (~350 KB compressed), fetched at most once per page and shared by everything that needs it.
    injuries() {
      if (!this._inj) {
        const c = new AbortController(), t = setTimeout(() => c.abort(), 9000);
        this._inj = fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries', { signal: c.signal })
          .then(r => { clearTimeout(t); if (!r.ok) throw new Error(r.status); return r.json(); }).catch(() => null);
      }
      return this._inj;
    },
    async _load() {
      const [league, brand, history] = await Promise.all([getJSON('data/league.json'), getJSON('data/franchises.json'),
        getJSON('data/history.json').catch(() => ({ seasons: [] }))]);
      const live = !!league.sleeperLeagueId;
      const [raw, hub] = await Promise.all([live ? loadLive(league.sleeperLeagueId, league.regularSeasonWeeks) : loadSample(), live ? null : hubRosters()]);
      if (hub) {
        await applyHub(raw, hub);
        const el = document.querySelector('#sample-flag .wrap'), e = v => String(v || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        if (el) el.innerHTML = `Preview · rosters are from the official Draft Room draft <a href="draftroom.html?d=${e(hub.source)}">${e(hub.name)}</a>; past scores, trades and picks are placeholders`;
      }
      const model = { ...build(league, brand, { ...raw, history }), live, hub, hubStart: raw.hubStart || null, seasonStats: raw.seasonStats || null,
        waivers: hub ? hub.waivers : {}, faab: hub ? hub.faab : {}, bracket: hub ? hub.bracket : null };
      if (hub && window.NFL) applyLive(model, await NFL.liveScores().catch(() => null));
      return model;
    },
    headshot: id => `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`,
  };
})();
