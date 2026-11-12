/* Lineup editing on the team page's Depth Chart (team.html), for the Hub's own rosters.
   Who may edit: the GM linked to this team (users/{uid}.team) and the commissioners. Everyone else just sees the field.
   Every change goes through the "lineup" function (functions/index.js), which checks the rulebook (eligible spots,
   kickoff locks, IR/taxi rules, 24 active, 2 QBs) and saves it; this page only asks and then redraws.
   Tap a spot on the field -> the players who can fill it (bench, or a starter who can swap over).
   Tap "Move" on a bench player -> the spots he can start in, or IR / taxi. "Activate" brings a taxi or IR player back. */
import { app, auth, db } from './fb.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js';

const { esc, shot, f1 } = UI;
const call = httpsCallable(getFunctions(app, 'us-central1'), 'lineup');
const ELIG = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], K: ['K'], DL: ['DL'], LB: ['LB'], DB: ['DB'], IDP_FLEX: ['DL', 'LB', 'DB'] };
const LABEL = { FLEX: 'Flex (RB/WR/TE)', SUPER_FLEX: 'Superflex (QB/RB/WR/TE)', IDP_FLEX: 'IDP flex (DL/LB/DB)' };
let myTeam = null, commish = false, games = {}, busy = false;

// ---------- this week's NFL games: opponent, kickoff, lock ----------
const day = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
let liveData = null;
// A player's latest fantasy score: from the newest live scoring (functions/index.js liveScores), with its week. A player
// whose game in that week has kicked off but has no stats yet scored 0; one whose game hasn't started (or a bye) has none.
function pts(id) {
  if (!liveData || !window.TeamPage) return null;
  const v = liveData.players && liveData.players[id];
  if (v) return { pts: v[0], week: liveData.week, line: v[2] };
  const p = TeamPage.P(id), g = p && p.team && (liveData.games || []).find(x => x.away.abbr === p.team || x.home.abbr === p.team);
  return g && g.state !== 'pre' ? { pts: 0, week: liveData.week, line: '' } : null;
}
async function loadGames() {
  const [live, M] = await Promise.all([window.NFL ? NFL.liveScores().catch(() => null) : null, Hub.load()]);
  let list = live && +live.week === +M.current ? live.games : null;      // live/current can still be last week's games
  if (!list) { const snap = await fetch('data/nfl.json').then(r => r.json()).catch(() => ({})); list = (snap.games || []).map(g => ({ ...g, away: { abbr: g.away.abbr, score: g.away.score }, home: { abbr: g.home.abbr, score: g.home.score } })); }
  games = {}; liveData = live || null;
  for (const g of list || []) for (const [me, opp, home] of [[g.away.abbr, g.home.abbr, false], [g.home.abbr, g.away.abbr, true]]) games[me] = { ...g, opp, home };
}
function game(id) {
  const p = window.TeamPage && TeamPage.P(id); const g = p && p.team && games[p.team];
  if (!p || !p.team) return null;
  if (!g) return { text: 'Bye', locked: false, bye: true };
  const locked = g.state !== 'pre' || Date.parse(g.at) <= Date.now();
  const vs = `${g.home ? 'vs' : '@'} ${g.opp}`;
  return { locked, text: g.state === 'in' ? `${vs} · live ${g.detail || ''}` : g.state === 'post' ? `${vs} · final` : `${vs} · ${day(g.at)}` };
}

// ---------- helpers on the page's data ----------
const P = id => TeamPage.P(id);
const R = () => TeamPage.T.roster;
const SL = () => TeamPage.M.slots;
const lineup = () => SL().map((_, i) => { const id = R().starters[i]; return id && id !== '0' ? id : null; });
const activeIds = () => R().players.filter(id => !R().taxi.includes(id) && !R().reserve.includes(id));
const ppg = id => { const s = (TeamPage.M.seasonStats || {})[id]; return s && s[0] ? s[1] / s[0] : 0; };
const hurt = id => ['IR', 'Out', 'Doubtful', 'Sus', 'PUP'].includes(P(id).injury_status);

async function send(data, done) {
  if (busy) return; busy = true;
  try {
    const r = (await call({ team: TeamPage.T.id, ...data, ...(+TeamPage.T.id !== myTeam ? { override: true } : {}) })).data;
    const ro = R(); ro.starters = r.slots.map(x => x || '0'); ro.reserve = r.ir; ro.taxi = r.taxi;
    const g = TeamPage.T.games.find(x => x.live); if (g) g.me.starters = ro.starters.slice();
    if (done) toast(done);
    dispatchEvent(new Event('hub:lineup'));
  } catch (e) { toast(e.message.replace(/^.*?: /, ''), true); } finally { busy = false; }
}
function toast(msg, bad) {
  let el = document.getElementById('lu-toast'); if (!el) { el = document.createElement('div'); el.id = 'lu-toast'; document.body.appendChild(el); }
  el.textContent = msg; el.className = bad ? 'bad' : ''; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 4000);
}

// ---------- the sheet ----------
function sheet(title, sub, items) {
  const d = document.createElement('dialog'); d.className = 'lu-sheet';
  d.innerHTML = `<div class="lu-head"><div><span class="eyebrow">${esc(sub)}</span><h3>${esc(title)}</h3></div><button class="pc-x" type="button" aria-label="Close">&times;</button></div>
    <div class="lu-items">${items.map((it, k) => `<button type="button" class="lu-item${it.off ? ' off' : ''}" data-k="${k}"${it.off ? ' disabled' : ''}>${it.html}</button>`).join('') || '<div class="empty">No one can fill this spot.</div>'}</div>`;
  document.body.appendChild(d);
  d.addEventListener('click', e => {
    if (e.target === d || e.target.closest('.pc-x')) return d.close();
    const b = e.target.closest('.lu-item'); if (!b || b.disabled) return;
    d.close(); items[+b.dataset.k].go();
  });
  d.addEventListener('close', () => d.remove());
  d.showModal();
}
function who(id, note) {
  const p = P(id), g = game(id);
  return `${shot(id)}<span class="lu-who"><b>${esc(p.full_name)} ${UI.status(p)}</b><small><span class="pos ${esc(p.position)}">${esc(p.position)}</span> ${esc(p.team || 'FA')}${g ? ` · ${esc(g.text)}` : ''}${note ? ` · ${note}` : ''}</small></span>
    <span class="lu-ppg">${ppg(id) ? f1(ppg(id)) : '-'}<small>pts/g</small></span>${g && g.locked ? '<span class="lu-lock">🔒</span>' : ''}`;
}

function openSlot(i) {
  const slots = SL(), cur = lineup(), occ = cur[i], slot = slots[i];
  if (occ && game(occ) && game(occ).locked) return toast(`${P(occ).full_name}'s game has started; he's locked in (rule 7-4-2).`, true);
  const cands = activeIds().filter(id => id !== occ && ELIG[slot].includes(P(id).position))
    .sort((a, b) => (cur.includes(a) - cur.includes(b)) || ppg(b) - ppg(a));
  const items = cands.map(id => {
    const j = cur.indexOf(id), locked = game(id) && game(id).locked;
    const back = j >= 0 && occ && ELIG[slots[j]].includes(P(occ).position);
    const note = j >= 0 ? `starting at ${esc(UI.SLOT_SHORT[slots[j]] || slots[j])}${occ ? (back ? `, swaps with ${esc(P(occ).full_name)}` : ', leaves that spot empty') : ''}` : '';
    return { off: locked, html: who(id, note), go: () => { const n = cur.slice(); n[i] = id; if (j >= 0) n[j] = back ? occ : null; send({ action: 'set', slots: n }, `${P(id).full_name} is starting at ${UI.SLOT_SHORT[slot] || slot}.`); } };
  });
  if (occ) items.unshift({ html: `<span class="lu-who"><b>Bench ${esc(P(occ).full_name)}</b><small>Leaves this spot empty</small></span>`, go: () => { const n = cur.slice(); n[i] = null; send({ action: 'set', slots: n }, `${P(occ).full_name} moved to the bench.`); } });
  sheet(LABEL[slot] || slot, `Week ${TeamPage.M.current} · ${occ ? `now: ${P(occ).full_name}` : 'empty spot'}`, items);
}

function openMove(id, where) {
  const p = P(id), cur = lineup(), slots = SL(), items = [];
  if (where === 'bench') {
    const locked = game(id) && game(id).locked;
    slots.forEach((s, i) => {
      if (!ELIG[s].includes(p.position)) return;
      const occ = cur[i], ol = occ && game(occ) && game(occ).locked;
      items.push({ off: locked || ol, html: `<span class="lu-who"><b>Start at ${esc(LABEL[s] || s)}</b><small>${occ ? `replaces ${esc(P(occ).full_name)}${ol ? ' (locked)' : ''}` : 'empty spot'}</small></span>`,
        go: () => { const n = cur.slice(); n[i] = id; send({ action: 'set', slots: n }, `${p.full_name} is starting at ${UI.SLOT_SHORT[s] || s}.`); } });
    });
    const irOk = ['IR', 'Out'].includes(p.injury_status);
    items.push({ off: !irOk || R().reserve.length >= 4, html: `<span class="lu-who"><b>Move to injured reserve</b><small>${irOk ? (R().reserve.length >= 4 ? 'IR is full (4)' : `listed ${esc(p.injury_status)}; frees a roster spot`) : `only players listed IR or Out (rule 8-1-3); he's ${esc(p.injury_status || 'healthy')}`}</small></span>`,
      go: () => send({ action: 'move', player: id, to: 'ir' }, `${p.full_name} moved to IR.`) });
    const rookie = p.years_exp === 0, wasUp = ((TeamPage.M.hub || {}).promoted || []).includes(id);
    items.push({ off: !rookie || wasUp || R().taxi.length >= 5, html: `<span class="lu-who"><b>Move to taxi squad</b><small>${wasUp ? 'promoted off a taxi squad already; he can\'t go back (rule 8-1-2)' : rookie ? (R().taxi.length >= 5 ? 'taxi squad is full (5)' : 'rookie; frees a roster spot') : 'rookies only (rule 8-1-2)'}</small></span>`,
      go: () => send({ action: 'move', player: id, to: 'taxi' }, `${p.full_name} moved to the taxi squad.`) });
  } else {
    const full = activeIds().length >= 24;
    items.push({ off: full, html: `<span class="lu-who"><b>Activate to the bench</b><small>${full ? '24 active players already: move someone to IR or taxi first' : `from ${where === 'ir' ? 'IR' : 'the taxi squad; once promoted he can\'t go back on taxi (rule 8-1-2)'}`}</small></span>`,
      go: () => send({ action: 'move', player: id, to: 'active' }, `${p.full_name} is active.`) });
  }
  sheet(p.full_name, `${p.position} · ${p.team || 'FA'} · ${where === 'bench' ? 'bench' : where === 'ir' ? 'injured reserve' : 'taxi squad'}`, items);
}

// Fill empty spots with the best available bench players by points per game (healthy, not yet kicked off).
function fill() {
  const slots = SL(), n = lineup(), used = new Set(n.filter(Boolean));
  const order = slots.map((s, i) => i).sort((a, b) => ELIG[slots[a]].length - ELIG[slots[b]].length);
  for (const i of order) {
    if (n[i]) continue;
    const best = activeIds().filter(id => !used.has(id) && ELIG[slots[i]].includes(P(id).position) && !hurt(id) && !(game(id) && (game(id).locked || game(id).bye)))
      .sort((a, b) => ppg(b) - ppg(a))[0];
    if (best) { n[i] = best; used.add(best); }
  }
  send({ action: 'set', slots: n }, 'Empty spots filled with your best available players.');
}

document.addEventListener('click', e => {
  if (!window.LineupEdit || !window.TeamPage || !LineupEdit.can(TeamPage.T.id)) return;
  const s = e.target.closest('[data-lslot]'), m = e.target.closest('[data-lmove]'), f = e.target.closest('[data-lfill]');
  if (m) { e.preventDefault(); e.stopPropagation(); openMove(m.dataset.lmove, m.dataset.where); return; }
  if (s && s.tagName === 'BUTTON') { e.preventDefault(); openSlot(+s.dataset.lslot); return; }
  if (f) fill();
}, true);

window.LineupEdit = { can: () => false, game, pts };
loadGames().then(() => dispatchEvent(new Event('hub:lineup')));
setInterval(() => loadGames().then(() => dispatchEvent(new Event('hub:lineup'))), 60000);   // live scores refresh every 2 minutes
onAuthStateChanged(auth, async user => {
  if (!user) return;
  const [roles, prof] = await Promise.all([getDoc(doc(db, 'config', 'roles')).catch(() => null), getDoc(doc(db, 'users', user.uid)).catch(() => null)]);
  commish = (((roles && roles.data()) || {}).commish || []).includes(user.uid);
  const t = ((prof && prof.data()) || {}).team; myTeam = t == null ? null : +t;
  window.LineupEdit = { can: id => (myTeam != null && +id === myTeam) || (commish && editOn(id)), game, pts };
  dispatchEvent(new Event('hub:lineup'));
  commishBar();
});

// ---------- Commissioner edit ----------
// The commissioner sees other teams read-only, like any GM, until switching Commissioner edit on for that team (for
// this browser session). The server refuses an override without it and logs every one as a Commissioner transaction.
const CE_KEY = 'blitz.commishEdit';
function editOn(id) { try { return JSON.parse(sessionStorage.getItem(CE_KEY) || '[]').includes(+id); } catch (e) { return false; } }
function setEdit(id, on) {
  let l = []; try { l = JSON.parse(sessionStorage.getItem(CE_KEY) || '[]'); } catch (e) { /* */ }
  l = on ? [...new Set([...l, +id])] : l.filter(x => x !== +id);
  try { sessionStorage.setItem(CE_KEY, JSON.stringify(l)); } catch (e) { /* private mode: stays off */ }
}
function commishBar() {
  const old = document.getElementById('ce-bar');
  if (!commish || !window.TeamPage || !TeamPage.T || +TeamPage.T.id === myTeam) { if (old) old.remove(); return; }
  const id = TeamPage.T.id, on = editOn(id), name = TeamPage.T.f.location;
  const html = `<div id="ce-bar" class="ce-bar${on ? ' on' : ''}"><span>${on ? `<b>Commissioner edit is ON</b> for ${UI.esc(name)}. Every change is logged on this team's Transactions for the league to see (11-2-1).`
    : `<b>Commissioner edit is off.</b> ${UI.esc(name)}'s lineup and roster are read-only.`}</span>
    <button class="btn small${on ? '' : ' primary'}" type="button">${on ? 'Turn off' : 'Turn on Commissioner edit'}</button></div>`;
  const host = document.getElementById('content'); if (!host) return;
  if (old) old.outerHTML = html; else host.insertAdjacentHTML('beforebegin', html);
  document.querySelector('#ce-bar button').onclick = () => {
    if (!on && !confirm(`Turn on Commissioner edit for ${name}? Any lineup or roster change you make will be logged on their Transactions for the whole league.`)) return;
    setEdit(id, !on); commishBar(); dispatchEvent(new Event('hub:lineup'));
  };
}
addEventListener('hashchange', () => setTimeout(commishBar, 0));
addEventListener('hub:lineup', () => commishBar());
