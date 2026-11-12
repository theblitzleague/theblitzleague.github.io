/* Roster moves for the signed-in GM (rule 8-4): Add a free agent, Claim a player on waivers with a blind FAAB bid, Drop a
   player. js/ui.js loads this on devices where someone has signed in, once the Hub's own rosters are in use.
   The buttons live on the player card (any page). Network > Players shows the GM's FAAB budget and pending claims
   (#my-moves). Every move goes through the "moves" function (functions/index.js), which checks the rules; this page
   asks, then updates the page's copy of the rosters and redraws. */
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { doc, getDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js';
import { app, auth, db } from './fb.js';

const { esc, f1 } = UI;
const call = httpsCallable(getFunctions(app, 'us-central1'), 'moves');
const BUDGET = 100, ACTIVE_MAX = 24;
let M = null, myTeam = null, claims = [];

const P = id => M.players[id] || { full_name: `Player ${id}`, position: '?' };
const owner = id => Object.values(M.teams).find(t => (t.roster.players || []).includes(id)) || null;
const mine = () => (myTeam != null ? M.teams[myTeam] : null);
const active = t => t.roster.players.filter(id => !t.roster.reserve.includes(id) && !t.roster.taxi.includes(id));
// On waivers until the Wednesday 3 AM batch clears him (at least two days after the drop, rule 8-4-1).
const onWaivers = id => (M.waivers || {})[id] || null;
// FAAB is $100 a season (8-4-2): last season's spending doesn't count once the League is in a new season.
const spent = () => (M.faab && (!M.calendar || String(M.faab.season) === String(M.calendar.season)) ? ((M.faab.spent || {})[String(myTeam)] || 0) : 0);
const left = () => BUDGET - spent();
const when = ms => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

function toast(msg, bad) {
  let el = document.getElementById('mv-toast'); if (!el) { el = document.createElement('div'); el.id = 'mv-toast'; document.body.appendChild(el); }
  el.textContent = msg; el.className = bad ? 'bad' : ''; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 4500);
}
async function send(data, done) {
  try {
    const r = (await call({ team: myTeam, ...data })).data;
    if (r.roster) {                                     // add / drop: update this page's rosters, lineup and waivers
      const t = mine(); t.roster.players = r.roster; t.roster.reserve = r.ir || []; t.roster.taxi = r.taxi || [];
      if (r.slots) t.roster.starters = r.slots.map(x => x || '0');
      M.waivers = r.waivers || M.waivers;
    }
    await loadClaims();
    toast(done);
    dispatchEvent(new Event('hub:moves'));
    return true;
  } catch (e) { toast(e.message.replace(/^.*?: /, ''), true); return false; }
}

async function loadClaims() {
  if (myTeam == null) { claims = []; return; }
  const s = await getDocs(query(collection(db, 'claims'), where('team', '==', myTeam), where('status', '==', 'pending'))).catch(() => null);
  claims = s ? s.docs.map(d => ({ id: d.id, ...d.data() })) : [];
}

// The drop picker: needed when the active roster is full (24); optional otherwise.
function dropSelect(required) {
  const t = mine(), list = active(t).slice().sort((a, b) => UI.POS_ORDER.indexOf(P(a).position) - UI.POS_ORDER.indexOf(P(b).position));
  return `<label class="mv-drop">${required ? 'Drop (your roster is full)' : 'Drop (optional)'} <select name="drop"${required ? ' required' : ''}><option value="">${required ? 'Pick a player…' : 'Nobody'}</option>
    ${list.map(id => `<option value="${esc(id)}">${esc(P(id).position)} · ${esc(P(id).full_name)}</option>`).join('')}</select></label>`;
}

// The player card's buttons.
function cardActions(id, el) {
  const t = mine(); if (!t || !M.hub) return;
  const p = P(id), own = owner(id), w = onWaivers(id), full = active(t).length >= ACTIVE_MAX;
  let html = '';
  if (own && own.id === t.id) {
    html = `<button class="btn" data-mv="drop">Drop ${esc(p.full_name.split(' ').slice(-1)[0])}</button><span class="pmeta">He goes on waivers and clears in the Wednesday 3 AM waiver run at least 2 days later (rule 8-4-1).</span>`;
  } else if (own) {
    return;                                            // on another team: trades come later
  } else if (w) {
    const c = claims.find(x => x.player === id);
    html = `<form class="mv-form" data-mv="claim"><div class="mv-row"><b>On waivers · clears ${esc(when(w.until))}</b><span class="pmeta">Blind bid · $${left()} of $${BUDGET} FAAB left</span></div>
      <div class="mv-row"><label>Bid $ <input name="bid" type="number" min="1" max="${left()}" step="1" value="${c ? c.bid : 1}" required></label>${dropSelect(false)}
      <button class="btn primary" type="submit">${c ? 'Update claim' : 'Place claim'}</button>${c ? `<button class="btn" type="button" data-mv="cancel" data-claim="${esc(c.id)}">Cancel claim</button>` : ''}</div>
      ${full ? `<span class="pmeta">Your roster is full. If you win him without a drop, he still joins you, and your lineup is frozen until you're back to ${ACTIVE_MAX} active (rule 8-1-1).</span>` : ''}
      ${c ? `<span class="pmeta">Your claim: $${c.bid}${c.drop ? `, dropping ${esc(P(c.drop).full_name)}` : ''}.</span>` : ''}</form>`;
  } else {
    html = `<form class="mv-form" data-mv="add"><div class="mv-row"><b>Free agent</b><span class="pmeta">Added at once, no bid.</span></div>
      <div class="mv-row">${full ? dropSelect(true) : dropSelect(false)}<button class="btn primary" type="submit">Add ${esc(p.full_name.split(' ').slice(-1)[0])}</button></div></form>`;
  }
  el.innerHTML = html; el.hidden = false; el.dataset.pid = id;
}

function confirmBox(title, body, yes) {
  return new Promise(res => {
    const d = document.createElement('dialog'); d.className = 'dr-confirm';
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><p>${body}</p><div class="dr-cbtns"><button class="btn" value="no">Cancel</button><button class="btn danger" value="yes">${esc(yes)}</button></div></form>`;
    document.body.appendChild(d); d.addEventListener('close', () => { res(d.returnValue === 'yes'); d.remove(); }); d.showModal();
  });
}

document.addEventListener('submit', async e => {
  const f = e.target.closest('.mv-form'); if (!f) return;
  e.preventDefault();
  const id = f.closest('.pc-actions').dataset.pid, drop = f.drop ? f.drop.value || null : null, b = f.querySelector('[type=submit]');
  b.disabled = true;
  const ok = f.dataset.mv === 'claim'
    ? await send({ action: 'claim', player: id, bid: f.bid.value, drop }, `Claim placed: $${f.bid.value} on ${P(id).full_name}. Bids are blind; it's settled in the ${when(onWaivers(id) ? onWaivers(id).until : Date.now())} waiver run.`)
    : await send({ action: 'add', player: id, drop }, `${P(id).full_name} added${drop ? `, ${P(drop).full_name} dropped` : ''}.`);
  b.disabled = false;
  if (ok) cardActions(id, f.closest('.pc-actions'));
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-mv="drop"], [data-mv="cancel"], [data-mv-cancel]'); if (!b) return;
  if (b.dataset.mv === 'drop') {
    const el = b.closest('.pc-actions'), id = el.dataset.pid;
    if (!await confirmBox(`Drop ${P(id).full_name}?`, 'He goes on waivers and clears in the Wednesday 3 AM waiver run at least two days from now; if nobody claims him he becomes a free agent. You can claim him back like anyone else.', 'Yes, drop him')) return;
    if (await send({ action: 'drop', drop: id }, `${P(id).full_name} dropped. He's on waivers until the Wednesday waiver run.`)) { const d = el.closest('dialog'); if (d) d.close(); }
  } else {
    const id = b.dataset.claim || b.dataset.mvCancel;
    if (await send({ action: 'cancel', claim: id }, 'Claim cancelled.')) { const el = b.closest('.pc-actions'); if (el) cardActions(el.dataset.pid, el); }
  }
});

// Network > Players: budget and pending claims.
function panel() {
  const el = document.getElementById('my-moves'); if (!el) return;
  const t = mine(); if (!t) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="mv-panel"><div><span class="eyebrow">${esc(t.f.location)} · waivers</span><b>$${left()} <small>of $${BUDGET} FAAB left</small></b></div>
    <div class="mv-claims">${claims.length ? claims.sort((a, b) => a.until - b.until).map(c => `<div class="mv-claim"><span data-pid="${esc(c.player)}"><b>${esc(P(c.player).full_name)}</b> <small>$${c.bid}${c.drop ? ` · drop ${esc(P(c.drop).full_name)}` : ''} · settles ${esc(when(c.until))}</small></span>
      <button class="btn" data-mv-cancel="${esc(c.id)}">Cancel</button></div>`).join('') : '<span class="pmeta">No pending claims. Tap a player for Add or Claim.</span>'}</div></div>`;
}
addEventListener('hub:moves', panel);
new MutationObserver(() => { const el = document.getElementById('my-moves'); if (el && !el.dataset.done) { el.dataset.done = '1'; panel(); } }).observe(document.body, { childList: true, subtree: true });

onAuthStateChanged(auth, async user => {
  if (!user) return;
  M = await Hub.load();
  const [prof, roles] = await Promise.all([getDoc(doc(db, 'users', user.uid)).catch(() => null), getDoc(doc(db, 'config', 'roles')).catch(() => null)]);
  const t = ((prof && prof.data()) || {}).team; myTeam = t == null ? null : +t;
  if (myTeam == null || !M.teams[myTeam]) return;
  await loadClaims();
  PlayerCard.actions.push(cardActions);
  panel();
});
