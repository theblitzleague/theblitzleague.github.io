/* Season tools for the commissioner (Account page). Everything runs through the "season" function (functions/index.js),
   which checks again and takes a backup before anything is changed.
   1. Close the season: once the Blitz Bowl is official, save it to the record book (history/{season}: records, champion,
      runner-up, third, division winners, weekly highs, points leader, prize amounts), the rookie draft order for next
      year (rule 8-2-3) and open next year's dues.
   2. Checklist for next season: taxi players past the 2-year limit (8-1-2), next season's schedule, FAAB, prizes.
   3. Founding reset (the 2026 test season only): clear the test league before the real startup draft. */
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js';
import { app } from './fb.js';

const { esc, teamName } = UI;
const call = httpsCallable(getFunctions(app, 'us-central1'), 'season', { timeout: 300000 });
const rec = t => t.wins + t.ties / 2;

// Rule 8-2-3: teams that missed the playoffs pick first, worst record first (ties: fewer points first); playoff teams
// follow in reverse order of finish (wild-card losers, worse record first, then 4th, 3rd, the runner-up); the champion last.
export function draftOrder(M) {
  const br = M.bracket || {}, T = M.teams, worse = (a, b) => rec(T[a]) - rec(T[b]) || T[a].pf - T[b].pf;
  const seeds = (br.seeds || []).map(s => +s.team), fin = (br.rounds || []).find(r => /Blitz Bowl/.test(r.name)) || { games: [] };
  const [bowl, third] = fin.games, wc = ((br.rounds || [])[0] || { games: [] }).games.map(g => +g.loser).filter(Boolean);
  const out = Object.keys(T).map(Number).filter(t => !seeds.includes(t)).sort(worse);
  out.push(...wc.sort(worse));
  if (third) out.push(+third.loser, +third.winner);
  if (bowl) out.push(+bowl.loser, +bowl.winner);
  return out.filter((t, i, a) => t && a.indexOf(t) === i);
}

// The season as the record book keeps it (same shape as data/history.json).
function entry(M) {
  const br = M.bracket, T = M.teams, reg = M.league.regularSeasonWeeks;
  const fin = br.rounds.find(r => /Blitz Bowl/.test(r.name)), [bowl, third] = fin.games;
  const po = {}; for (const r of br.rounds) for (const g of r.games) if (g.final) { (po[g.winner] = po[g.winner] || [0, 0])[0]++; (po[g.loser] = po[g.loser] || [0, 0])[1]++; }
  const topPf = Math.max(...Object.values(T).map(t => t.pf));
  return {
    season: String(br.season),
    teams: Object.fromEntries(Object.values(T).map(t => [t.id, { gm: t.gmKey || null, gmName: (t.f.gm && t.f.gm.name) || null, division: t.division ? t.division.id : null,
      wins: t.wins, losses: t.losses, ties: t.ties, pf: t.pf, pa: t.pa, playoffWins: (po[t.id] || [0, 0])[0], playoffLosses: (po[t.id] || [0, 0])[1] }])),
    champion: +bowl.winner, runnerUp: +bowl.loser, third: third && third.winner ? +third.winner : null,
    divisionWinners: (br.seeds || []).filter(s => /Division/.test(s.how)).map(s => +s.team),
    weeklyHigh: M.weekly.filter(w => w.week <= reg).map(w => ({ week: w.week, points: w.points, rosters: w.winners.map(t => t.id) })),
    pointsLeader: Object.values(T).filter(t => t.pf === topPf).map(t => t.id),
    prizes: M.league.prizes || {}, gmOfYear: null,
  };
}

export async function seasonTools(M, box, isOwner) {
  const schedFile = await fetch('data/schedule.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => ({}));
  const br = M.bracket || {}, season = String(br.season || M.state.season);
  const fin = (br.rounds || []).find(r => /Blitz Bowl/.test(r.name || ''));
  const done = !!(br.champion && fin && fin.games.every(g => g.final));
  const archived = (M.history || []).some(s => String(s.season) === season) || String((M.league.seasonConfig || {}).archived || '') === season;
  const order = done ? draftOrder(M) : [];
  const next = +season + 1, sched = Object.keys(schedFile).filter(k => /^\d{4}$/.test(k));
  const test = M.hub && (+season === 2026);
  const name = id => (M.teams[id] ? esc(teamName(M.teams[id])) : `Team ${id}`);
  box.innerHTML = `<section class="panel s12"><header><div><span class="eyebrow">Commissioner</span><h2>Season tools</h2></div></header>
    <div class="sub">1. Close the ${esc(season)} season</div>
    ${test ? `<p class="acct-note">2026 is the test season, so it doesn't go in the record book. Use the founding reset below before the startup draft.</p>`
      : archived ? `<p class="acct-note">✅ The ${esc(season)} season is in the record book. Next year's dues (${next}) and the rookie draft order are open.</p>`
      : done ? `<p class="acct-note">The Blitz Bowl is official: <b>${name(br.champion)}</b> are champions. Saving puts the season in the record book (records, titles,
          division winners, weekly highs, points leader and prize amounts), sets the ${next} rookie draft order and opens ${next} dues. A backup is taken first.</p>
          <div class="acct-row"><button class="btn primary" id="st-archive">Save the ${esc(season)} season to the record book</button><span class="pmeta" id="st-msg"></span></div>`
      : `<p class="acct-note">Available once the Blitz Bowl is official (rule 2-2-3). Until then nothing here changes anything.</p>`}
    ${order.length ? `<div class="sub">${next} rookie draft order (rule 8-2-3)</div><ol class="st-order">${order.map(t => `<li>${name(t)}</li>`).join('')}</ol>
      <p class="pmeta">Traded picks are handled in the draft room: each pick goes to the team that owns it when the draft starts.</p>` : ''}
    <div class="sub">2. Before ${next}</div>
    <ul class="st-list">
      <li><b>Taxi squads:</b> <span id="st-taxi">checking…</span></li>
      <li><b>Schedule:</b> ${sched.includes(String(next)) ? `the ${next} schedule is ready.` : `<span class="bad">no ${next} schedule yet. Ask Claude to build it.</span>`}</li>
      <li><b>FAAB:</b> every team goes back to $100 automatically when the ${next} NFL season starts (8-4-2).</li>
      <li><b>Prizes:</b> record each ${esc(season)} payout in Awards › Prizes &amp; Ledger.</li>
      <li><b>Rookie draft:</b> create it in the Draft Room as a Rookie draft; it uses the order above and adds the picks to the rosters.</li>
    </ul>
    ${test && isOwner ? `<div class="sub">3. Founding reset (test season only)</div>
      <p class="acct-note">Clears the 2026 test league so the real league starts clean at the startup draft: rosters, lineups, results, moves, trades,
        waiver claims, FAAB, traded picks and the bracket. Accounts, the commissioner list, the ledger, messages, scoring settings and drafts stay.
        A full backup is taken first.</p>
      <div class="acct-row"><input id="st-confirm" placeholder="Type RESET 2026"><button class="btn danger" id="st-found">Founding reset</button><span class="pmeta" id="st-fmsg"></span></div>` : ''}
  </section>`;
  const $ = id => box.querySelector('#' + id);
  call({ action: 'taxi' }).then(r => {
    const o = r.data.over || [];
    $('st-taxi').innerHTML = !o.length ? 'nobody is past the 2-year limit.'
      : `${o.map(x => `${esc(x.name)} (${name(x.team)})`).join(', ')} ${o.length > 1 ? 'are' : 'is'} past the 2-year limit (8-1-2). <button class="btn small" id="st-notify">Message those GMs</button>`;
    const n = $('st-notify'); if (n) n.onclick = async () => { n.disabled = true; await call({ action: 'taxi', notify: true }); n.textContent = 'Sent'; };
  }).catch(e => { $('st-taxi').textContent = `couldn't check (${e.message})`; });
  const a = $('st-archive');
  if (a) a.onclick = async () => {
    if (!confirm(`Save the ${season} season to the record book and open ${next}?`)) return;
    a.disabled = true; $('st-msg').textContent = 'Backing up and saving…';
    try { await call({ action: 'archive', entry: entry(M), draftOrder: order }); $('st-msg').textContent = 'Saved. Reloading…'; setTimeout(() => location.reload(), 900); }
    catch (e) { $('st-msg').textContent = e.message.replace(/^.*?: /, ''); a.disabled = false; }
  };
  const f = $('st-found');
  if (f) f.onclick = async () => {
    const c = $('st-confirm').value.trim();
    if (c !== 'RESET 2026') { $('st-fmsg').textContent = 'Type RESET 2026 exactly.'; return; }
    if (!confirm('Clear the whole 2026 test league now? A backup is taken first, but the site will show no rosters until the startup draft.')) return;
    f.disabled = true; $('st-fmsg').textContent = 'Backing up and clearing…';
    try { await call({ action: 'founding', confirm: c }); $('st-fmsg').textContent = 'Done. Reloading…'; setTimeout(() => location.reload(), 1200); }
    catch (e) { $('st-fmsg').textContent = e.message.replace(/^.*?: /, ''); f.disabled = false; }
  };
}
