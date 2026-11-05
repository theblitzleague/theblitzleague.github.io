/* Player card: click any element with data-pid (or press Enter on it) to open that player's stats.
   Stats come from Sleeper's per-player game log endpoint (api.sleeper.com/stats/...). That endpoint is the one the
   Sleeper app uses; it is NOT in Sleeper's documented API, so it can change without notice. The card fails soft.
   Fantasy points: live mode scores each game with the league's own scoring_settings (and prefers the league's own
   players_points for weeks the player was rostered). Sample mode shows Sleeper's default PPR / IDP points. */
(function () {
  const { esc, f1, shot, status, pmeta } = UI;
  const STATS = (id, season) => `https://api.sleeper.com/stats/nfl/player/${encodeURIComponent(id)}?season_type=regular&season=${season}&grouping=week`;
  const cache = new Map();
  const DEF = ['DL', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'SS', 'FS'];
  const n = (s, k) => (s && s[k]) || 0;
  const ratio = (a, b) => (s => `${n(s, a)}/${n(s, b)}`);
  const snap = (who, team) => (s => (n(s, team) ? Math.round(n(s, who) / n(s, team) * 100) + '%' : '-'));

  // Columns per position. [label, stat key or function, sum-able]
  const COLS = {
    QB: [['C/Att', ratio('pass_cmp', 'pass_att'), ['pass_cmp', 'pass_att']], ['Pass yd', 'pass_yd'], ['TD', 'pass_td'], ['INT', 'pass_int'], ['Rush', 'rush_att'], ['Rush yd', 'rush_yd'], ['Rush TD', 'rush_td']],
    RB: [['Snap', snap('off_snp', 'tm_off_snp')], ['Att', 'rush_att'], ['Rush yd', 'rush_yd'], ['TD', 'rush_td'], ['Tgt', 'rec_tgt'], ['Rec', 'rec'], ['Rec yd', 'rec_yd'], ['Rec TD', 'rec_td']],
    WR: [['Snap', snap('off_snp', 'tm_off_snp')], ['Tgt', 'rec_tgt'], ['Rec', 'rec'], ['Yd', 'rec_yd'], ['TD', 'rec_td'], ['Rush yd', 'rush_yd']],
    K: [['FG', ratio('fgm', 'fga'), ['fgm', 'fga']], ['Long', 'fgm_lng', 'max'], ['XP', ratio('xpm', 'xpa'), ['xpm', 'xpa']]],
    IDP: [['Snap', snap('def_snp', 'tm_def_snp')], ['Tkl', 'idp_tkl'], ['Solo', 'idp_tkl_solo'], ['Ast', 'idp_tkl_ast'], ['TFL', 'idp_tkl_loss'], ['Sack', 'idp_sack'],
      ['QB hit', 'idp_qb_hit'], ['PD', 'idp_pass_def'], ['INT', 'idp_int'], ['FF', 'idp_ff'], ['FR', 'idp_fum_rec'], ['TD', 'idp_def_td']],
  };
  // Team defense columns: keys Sleeper didn't record are hidden automatically, so unconfirmed ones cost nothing.
  COLS.DEF = [['Pts allowed', 'pts_allow'], ['Sack', 'def_sack'], ['INT', 'def_int'], ['FR', 'def_fum_rec'], ['TD', 'def_td'], ['Safety', 'def_safe']];
  const group = pos => (DEF.includes(pos) ? 'IDP' : pos === 'TE' ? 'WR' : COLS[pos] ? pos : 'WR');

  let M = null, dlg = null, cur = null;

  function fantasy(stats, pos) {
    if (!stats) return null;
    if (M.live && M.scoring) return Object.entries(M.scoring).reduce((t, [k, v]) => t + n(stats, k) * v, 0);
    return DEF.includes(pos) ? n(stats, 'pts_idp') : n(stats, 'pts_ppr');
  }

  // In-league points and who started him, from the league's own matchups (live mode only: sample scores are invented).
  function leagueWeek(id, w) {
    if (!M.live) return null;
    for (const t of Object.values(M.teams)) {
      const g = t.games.find(g => g.week === w);
      if (g && g.me.players_points && id in g.me.players_points) return { t, pts: g.me.players_points[id], started: (g.me.starters || []).includes(id) };
    }
    return null;
  }

  // Sleeper first; if that call can't be made (the claude.ai preview blocks outside requests) or fails, fall back to the
  // saved copy that tools/build_stats.py writes to data/stats/<season>.json. Resolves {data, saved: built-date|null}.
  const snapshots = new Map();
  const snapshot = season => {
    if (!snapshots.has(season)) snapshots.set(season, fetch(`data/stats/${season}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null));
    return snapshots.get(season);
  };
  async function load(id, season) {
    const k = id + ':' + season;
    if (!cache.has(k)) cache.set(k, (async () => {
      let why;
      try {
        const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(STATS(id, season), { signal: ctl.signal }).finally(() => clearTimeout(t));
        if (r.ok) return { data: await r.json(), saved: null };
        why = `Sleeper returned ${r.status}`;
      } catch (e) { why = e.name === 'AbortError' ? 'Sleeper took too long' : 'Sleeper could not be reached'; }
      const snap = await snapshot(season);
      if (snap && snap.players && id in snap.players) return { data: snap.players[id], saved: snap.built };
      throw new Error(snap ? `${why}, and this player isn't in the saved copy` : why);
    })().catch(e => { cache.delete(k); throw e; }));
    return cache.get(k);
  }

  function owner(id) {
    for (const t of Object.values(M.teams)) if ((t.roster.players || []).includes(id)) return t;
    return null;
  }

  function shell(id) {
    const p = M.players[id] || { full_name: `Player ${id}`, position: '?' }, t = owner(id);
    const bits = [p.height ? `${Math.floor(p.height / 12)}'${p.height % 12}"` : null, p.weight ? `${p.weight} lb` : null, p.college || null,
      p.years_exp === 0 ? 'Rookie' : p.years_exp != null ? `${p.years_exp} yr${p.years_exp === 1 ? '' : 's'} exp` : null].filter(Boolean);
    const seasons = [M.state.season, String(+M.state.season - 1)];
    return `<div class="pc-head">${shot(id, 'pc-shot')}<div class="pc-id">
        <div class="pc-name">${esc(p.full_name)}</div>
        <div class="pc-sub"><span class="pos ${esc(p.position)}">${esc(p.position)}</span>${p.nflPos ? ` <span class="pmeta">${esc(p.nflPos)}</span>` : ''} ${esc(pmeta(p))} ${status(p)}</div>
        ${bits.length ? `<div class="pmeta">${esc(bits.join(' · '))}</div>` : ''}
        <div class="pc-own">${t ? `<a href="team.html?team=${t.id}#roster">${markSVG(t.f, 'mini')} ${esc(t.f.location)}${t.f.nickname ? ' ' + esc(t.f.nickname) : ''}</a>` : '<span class="pmeta">Free agent in this league</span>'}</div>
      </div><button class="pc-x" type="button" aria-label="Close">&times;</button></div>
      <div class="pc-seasons" role="tablist">${seasons.map(s => `<button type="button" role="tab" data-season="${s}">${s}</button>`).join('')}</div>
      <div class="pc-body"><div class="loading">Loading stats from Sleeper</div></div>`;
  }

  function table(id, season, data, saved) {
    const p = M.players[id] || { position: '?' }, cols = COLS[group(p.position)];
    const thisSeason = season === M.state.season;
    const last = thisSeason ? M.current - 1 : 18;                      // weeks that are finished
    const weeks = Array.from({ length: last }, (_, i) => i + 1);
    const games = weeks.map(w => ({ w, e: data[String(w)] })).filter(g => g.e || g.w <= last);
    const dnp = g => g.e && !n(g.e.stats, 'gp');                        // listed for the game but never got in
    const played = games.filter(g => g.e && !dnp(g));
    if (!played.length) return `<div class="empty">No ${esc(season)} regular-season stats for this player.</div>`;
    // Drop columns that are empty all season (e.g. a WR with no rushes, IDP stats Sleeper didn't record).
    const val = (c, s) => (typeof c[1] === 'function' ? c[1](s) : n(s, c[1]));
    const shown = cols.filter(c => typeof c[1] === 'function' || played.some(g => n(g.e.stats, c[1])));
    const lw = g => (thisSeason ? leagueWeek(id, g.w) : null);
    const showLeague = M.live && thisSeason;
    const fpts = g => { const l = lw(g); return l ? l.pts : fantasy(g.e && g.e.stats, p.position); };
    const total = played.reduce((t, g) => t + (fpts(g) || 0), 0);
    const sum = c => {
      if (c[2] === 'max') return Math.max(...played.map(g => n(g.e.stats, c[1])));
      if (Array.isArray(c[2])) return c[2].map(k => played.reduce((t, g) => t + n(g.e.stats, k), 0)).join('/');
      if (typeof c[1] === 'function') return '';
      const v = played.reduce((t, g) => t + n(g.e.stats, c[1]), 0); return v % 1 ? v.toFixed(1) : v;
    };
    const fmt = v => (typeof v === 'number' && v % 1 ? v.toFixed(1) : v);
    const label = M.live && M.scoring ? 'League scoring' : (DEF.includes(p.position) ? 'Sleeper default IDP scoring' : 'Sleeper default PPR scoring');
    return `<div class="statline pc-sum"><div><span class="big">${played.length}</span><span class="lbl">Games</span></div>
        <div><span class="big">${f1(total)}</span><span class="lbl">Fantasy pts</span></div><div><span class="big">${f1(total / played.length)}</span><span class="lbl">Per game</span></div></div>
      <div class="tablewrap"><table class="st pc-log"><thead><tr><th>Wk</th><th>Opp</th><th class="num">Fpts</th>${showLeague ? '<th>Team</th>' : ''}${shown.map(c => `<th class="num">${c[0]}</th>`).join('')}</tr></thead>
      <tbody>${games.map(g => {
        if (!g.e) return `<tr class="nogame"><td class="rank">${g.w}</td><td colspan="${shown.length + 2 + (showLeague ? 1 : 0)}">No stats (bye or inactive)</td></tr>`;
        if (dnp(g)) return `<tr class="nogame"><td class="rank">${g.w}</td><td>${g.e.is_away_team ? '@' : 'vs'} ${esc(g.e.opponent || '')}</td><td colspan="${shown.length + 1 + (showLeague ? 1 : 0)}">Did not play</td></tr>`;
        const l = lw(g), s = g.e.stats;
        return `<tr><td class="rank">${g.w}</td><td>${g.e.is_away_team ? '@' : 'vs'} ${esc(g.e.opponent || '')}</td><td class="num strong">${f1(fpts(g) || 0)}</td>
          ${showLeague ? `<td>${l ? `${markSVG(l.t.f, 'mini')}${l.started ? '' : ' <small>bench</small>'}` : '<small>FA</small>'}</td>` : ''}${shown.map(c => `<td class="num">${fmt(val(c, s))}</td>`).join('')}</tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="num strong">${f1(total)}</td>${showLeague ? '<td></td>' : ''}${shown.map(c => `<td class="num">${sum(c)}</td>`).join('')}</tr></tfoot></table></div>
      <p class="footnote pc-note">Fantasy points: ${label}. Stats from Sleeper${thisSeason ? `, through week ${last}` : ''}${saved ? `, from the saved copy built ${esc(saved)} (Sleeper couldn't be reached from here)` : ''}.</p>`;
  }

  async function show(id, season) {
    cur = { id, season };
    dlg.querySelectorAll('[data-season]').forEach(b => b.setAttribute('aria-selected', b.dataset.season === season));
    const body = dlg.querySelector('.pc-body');
    body.innerHTML = '<div class="loading">Loading stats from Sleeper</div>';
    try {
      const { data, saved } = await load(id, season);
      if (cur.id === id && cur.season === season) body.innerHTML = table(id, season, data || {}, saved);
    } catch (e) {
      if (cur.id === id) body.innerHTML = `<div class="empty">Couldn't load stats from Sleeper right now (${esc(e.message)}). The rest of the site is unaffected; try again in a minute.</div>`;
    }
  }

  async function open(id) {
    M = M || await Hub.load();
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'pcard-dlg';
      dlg.setAttribute('aria-label', 'Player stats');
      document.body.appendChild(dlg);
      dlg.addEventListener('click', e => {
        if (e.target === dlg || e.target.closest('.pc-x')) dlg.close();
        const s = e.target.closest('[data-season]');
        if (s && cur) show(cur.id, s.dataset.season);
      });
    }
    dlg.innerHTML = `<div class="pc-in">${shell(id)}</div>`;
    if (!dlg.open) dlg.showModal();
    show(id, M.state.season);
  }

  const trigger = e => {
    const el = e.target.closest('[data-pid]');
    if (!el || e.target.closest('dialog')) return;
    const a = e.target.closest('a[href]');
    if (a && el.contains(a) && a !== el) return;              // a real link inside the row still works
    e.preventDefault();
    open(el.dataset.pid).catch(err => console.error(err));
  };
  document.addEventListener('click', trigger);
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-pid]')) trigger(e); });

  window.PlayerCard = { open };
})();
