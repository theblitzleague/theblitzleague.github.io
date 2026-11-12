/* Trades tab on team pages (team.html#trades), for signed-in GMs (rule 8-3). js/ui.js loads this where someone is
   signed in and the Hub's own rosters are in use.
   Another team's page: build an offer (your players and picks for theirs, plus any drops you need to stay at 24 active).
   Your own page: offers made to you (accept, with drops if needed / reject / counter), offers you made (withdraw), trades
   in their two-day review (the commissioner can veto), and recent decisions.
   Every action goes through the "trades" function (functions/index.js), which checks the rules again. */
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { doc, getDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js';
import { app, auth, db } from './fb.js';

const { esc } = UI;
const call = httpsCallable(getFunctions(app, 'us-central1'), 'trades');
const ACTIVE_MAX = 24, ROUNDS = 4;
let M = null, myTeam = null, commish = false, list = [], counterOf = null, ready = false, paid = null;
const sel = { give: new Set(), get: new Set(), drops: new Set() };

const P = id => M.players[id] || { full_name: `Player ${id}`, position: '?' };
const tname = id => (M.teams[id] ? M.teams[id].f.location : `Team ${id}`);
const seasons = () => Array.from({ length: M.league.futurePickSeasons || 3 }, (_, i) => +M.state.season + 1 + i);
const pickOwner = p => { const t = (M.tradedPicks || []).find(x => +x.season === +p.season && +x.round === +p.round && +x.roster_id === +p.roster_id); return t ? +t.owner_id : +p.roster_id; };
const picksOf = team => seasons().flatMap(s => Array.from({ length: ROUNDS }, (_, r) => Object.keys(M.teams).map(o => ({ season: s, round: r + 1, roster_id: +o }))).flat()).filter(p => pickOwner(p) === +team);
const pkKey = p => `pk:${p.season}-${p.round}-${p.roster_id}`;
const pkLabel = p => `${p.season} round ${p.round}${+p.roster_id !== pickOwner(p) ? ` (${tname(p.roster_id)})` : ''}`;
const fromKey = k => { const [s, r, o] = k.slice(3).split('-').map(Number); return { season: s, round: r, roster_id: o }; };
const active = t => t.roster.players.filter(id => !t.roster.reserve.includes(id) && !t.roster.taxi.includes(id));
const when = ms => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const assets = a => [...(a.players || []).map(id => `<span${UI.pid(id)}><span class="pos ${esc(P(id).position)}">${esc(P(id).position)}</span> ${esc(P(id).full_name)}</span>`), ...(a.picks || []).map(p => `<span class="tr-pick">${esc(pkLabel(p))} pick</span>`)].join('') || '<span class="pmeta">Nothing</span>';

// Rule 8-3-5: a team trading away a pick in a future season must first prepay $50 of that season's dues. The ledger
// (Awards > Prizes & Ledger, where the commissioner records it) is the record: a prepay or dues entry for that season,
// not voided. The server checks the same thing when a trade is accepted; this only shows it ahead of time.
const VENMO = 'Venmo @gwilso22 (Friends & Family)';
async function loadPaid() {
  const ss = seasons();
  const docs = await getDocs(query(collection(db, 'ledger'), where('season', 'in', ss))).then(x => x.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => null);
  if (!docs) { paid = null; return; }
  const voided = new Set(docs.filter(e => e.kind === 'void').map(e => e.ref));
  paid = {};
  for (const e of docs) if (!voided.has(e.id) && ['prepay', 'dues'].includes(e.kind)) (paid[+e.team] = paid[+e.team] || new Set()).add(+e.season);
}
const owes = (team, season) => paid != null && +season > +M.state.season && !(paid[+team] && paid[+team].has(+season));
// The prepays a trade still needs: [{team, season}] for every future pick a side is sending without its prepay.
function needs(T) {
  const out = [];
  for (const [side, team] of [['give', T.from], ['get', T.to]]) for (const s of new Set((T[side].picks || []).map(p => +p.season)))
    if (owes(team, s)) out.push({ team: +team, season: s });
  return out;
}
const needText = n => `${esc(+n.team === +myTeam ? 'You' : tname(n.team))} must prepay $50 toward ${n.season} dues`;
const lockBox = (ns, tail) => (ns.length ? `<div class="tr-lock">🔒 <b>Can't be accepted yet (rule 8-3-5).</b> ${ns.map(needText).join('; ')}.${ns.some(n => +n.team === +myTeam) ? ` Pay with ${VENMO}, note "${ns.find(n => +n.team === +myTeam).season} dues prepay"; the commissioner records it in the ledger and the lock comes off.` : ''}${tail || ''}</div>` : '');

function toast(msg, bad) {
  let el = document.getElementById('mv-toast'); if (!el) { el = document.createElement('div'); el.id = 'mv-toast'; document.body.appendChild(el); }
  el.textContent = msg; el.className = bad ? 'bad' : ''; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 5000);
}
async function send(data, done) {
  try { await call(data); toast(done); await load(); return true; } catch (e) { toast(e.message.replace(/^.*?: /, ''), true); return false; }
}
async function load() {
  const q = (...w) => getDocs(query(collection(db, 'trades'), ...w)).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
  const [a, b, c] = await Promise.all([q(where('from', '==', myTeam)), q(where('to', '==', myTeam)), q(where('status', '==', 'review'))]);
  const by = {}; for (const t of [...a, ...b, ...c]) by[t.id] = t;
  list = Object.values(by).sort((x, y) => (y.at || 0) - (x.at || 0));
  await loadPaid();
  render();
}

// Where the trade window stands (rule 8-3-3): open until the last game of Week 11, closed until the Blitz Bowl is final.
function windowText() {
  const wk = +M.current, champ = M.bracket && M.bracket.champion;
  if (wk < 11) return '<b>Trading is open</b> until the last game of Week 11 ends (rule 8-3-3).';
  if (wk === 11) return '<b>Last week to trade:</b> trades must be accepted before the last game of Week 11 ends (rule 8-3-3).';
  return champ ? '<b>Trading is open</b> for the offseason.' : '<b>The trade deadline has passed.</b> Offers can still be sent, but none can be accepted until the Blitz Bowl is final (rule 8-3-3).';
}

// ---------- another team's page: the offer builder ----------
function builder(other) {
  const me = M.teams[myTeam], them = M.teams[other];
  const col = (t, side) => {
    const ids = t.roster.players.slice().sort((a, b) => UI.POS_ORDER.indexOf(P(a).position) - UI.POS_ORDER.indexOf(P(b).position));
    return `<div class="tr-col"><div class="sub">${side === 'give' ? 'You send' : `${esc(tname(t.id))} sends`}</div>
      <div class="tr-list">${ids.map(id => `<label class="tr-item"><input type="checkbox" data-side="${side}" value="${esc(id)}"${sel[side].has(id) ? ' checked' : ''}>
        <span class="pos ${esc(P(id).position)}">${esc(P(id).position)}</span><span>${esc(P(id).full_name)} <small>${esc(P(id).team || 'FA')}</small></span></label>`).join('')}</div>
      <div class="sub">Draft picks</div>
      <div class="tr-list tr-picks">${picksOf(t.id).map(p => `<label class="tr-item"><input type="checkbox" data-side="${side}" value="${pkKey(p)}"${sel[side].has(pkKey(p)) ? ' checked' : ''}><span class="tr-pick">${esc(pkLabel(p))}</span>${owes(t.id, p.season) ? `<small class="tr-owe">🔒 needs $50 toward ${p.season} dues</small>` : ''}</label>`).join('') || '<span class="pmeta">No picks to trade.</span>'}</div></div>`;
  };
  const inCount = [...sel.get].filter(k => !k.startsWith('pk:')).length, outCount = [...sel.give].filter(k => !k.startsWith('pk:')).length;
  const over = active(me).length - outCount + inCount - ACTIVE_MAX;
  return `<section class="panel"><header><div><span class="eyebrow">${counterOf ? 'Counter offer' : 'New offer'} · ${esc(tname(myTeam))} and ${esc(tname(other))}</span><h2>Propose a trade</h2></div></header>
    <div class="tr-build">${col(me, 'give')}${col(them, 'get')}</div>
    ${over > 0 ? `<div class="tr-drops"><b>You'd have ${active(me).length - outCount + inCount} active players (most is ${ACTIVE_MAX}). Pick ${over} to drop when it goes through:</b>
      <div class="tr-list">${active(me).filter(id => !sel.give.has(id)).map(id => `<label class="tr-item"><input type="checkbox" data-side="drops" value="${esc(id)}"${sel.drops.has(id) ? ' checked' : ''}><span class="pos ${esc(P(id).position)}">${esc(P(id).position)}</span><span>${esc(P(id).full_name)}</span></label>`).join('')}</div></div>` : ''}
    <div class="tr-sum"><div><span class="eyebrow">You send</span>${assets(split('give'))}</div><div><span class="eyebrow">You get</span>${assets(split('get'))}</div></div>
    ${lockBox(needs({ from: myTeam, to: other, give: split('give'), get: split('get') }), ' You can still send the offer.')}
    <p class="tr-window">${windowText()}</p>
    <div class="acct-row"><input id="tr-note" maxlength="300" placeholder="Note to ${esc(tname(other))} (optional)"><button class="btn primary" data-tr="send">${counterOf ? 'Send counter offer' : 'Send offer'}</button>${counterOf ? '<button class="btn" data-tr="nocounter">Cancel counter</button>' : ''}</div>
    <p class="footnote">An accepted trade sits in a two-day review, then goes through (rule 8-3-2). Picks up to three seasons ahead can be traded; trading away a future pick needs that season's $50 prepay first (8-3-5). No trades are accepted after the last game of Week 11 until the championship is final (8-3-3).</p></section>`;
}
const split = side => ({ players: [...sel[side]].filter(k => !k.startsWith('pk:')), picks: [...sel[side]].filter(k => k.startsWith('pk:')).map(fromKey) });

// ---------- your own page: offers and reviews ----------
function card(t) {
  const mineFrom = +t.from === +myTeam, other = mineFrom ? t.to : t.from;
  const youGive = mineFrom ? t.give : t.get, youGet = mineFrom ? t.get : t.give;
  const status = { offered: mineFrom ? `Waiting on ${tname(other)}` : `Offer from ${tname(other)}`, review: `In review until ${when(t.reviewUntil)}`, processed: 'Done', rejected: 'Rejected', cancelled: 'Withdrawn', countered: 'Countered', vetoed: 'Vetoed', failed: 'Failed' }[t.status] || t.status;
  const involved = +t.from === +myTeam || +t.to === +myTeam;
  const lock = t.status === 'offered' ? needs(t) : [];
  const btns = t.status === 'offered' && !mineFrom ? `<button class="btn primary" data-tr="accept" data-id="${t.id}"${lock.length ? ' disabled title="Locked until the prepay is in the ledger (8-3-5)"' : ''}>${lock.length ? '🔒 Accept' : 'Accept'}</button><button class="btn" data-tr="counter" data-id="${t.id}">Counter</button><button class="btn danger" data-tr="reject" data-id="${t.id}">Reject</button>`
    : t.status === 'offered' && mineFrom ? `<button class="btn" data-tr="cancel" data-id="${t.id}">Withdraw</button>`
    : t.status === 'review' && commish ? `<button class="btn danger" data-tr="veto" data-id="${t.id}">Veto</button>` : '';
  return `<div class="tr-card ${esc(t.status)}"><div class="tr-head"><b>${involved ? `${esc(tname(myTeam))} ⇄ ${esc(tname(other))}` : `${esc(tname(t.from))} ⇄ ${esc(tname(t.to))}`}</b><span class="tag">${esc(status)}</span></div>
    <div class="tr-sum"><div><span class="eyebrow">${involved ? 'You send' : `${esc(tname(t.from))} sends`}</span>${assets(involved ? youGive : t.give)}</div><div><span class="eyebrow">${involved ? 'You get' : `${esc(tname(t.to))} sends`}</span>${assets(involved ? youGet : t.get)}</div></div>
    ${(t.dropsFrom || []).length || (t.dropsTo || []).length ? `<div class="pmeta">Drops: ${[...(t.dropsFrom || []), ...(t.dropsTo || [])].map(id => esc(P(id).full_name)).join(', ')}</div>` : ''}
    ${t.note ? `<div class="pmeta">“${esc(t.note)}”</div>` : ''}${lockBox(lock)}<div class="tr-btns" data-box="${t.id}">${btns}</div></div>`;
}
function inbox() {
  const open = list.filter(t => t.status === 'offered'), review = list.filter(t => t.status === 'review'), done = list.filter(t => !['offered', 'review'].includes(t.status)).slice(0, 10);
  const sec = (title, items, empty) => `<section class="panel"><header><div><h2>${title}</h2></div><span class="aside">${items.length}</span></header>${items.length ? items.map(card).join('') : `<div class="empty">${empty}</div>`}</section>`;
  return `<div class="tr-inbox"><p class="tr-window">${windowText()}</p>${sec('Open offers', open, 'No open offers. To make one, open another team and choose its Trades tab.')}${sec('In review', review, 'No trades in review.')}${sec('Recent', done, 'Nothing yet.')}</div>`;
}

function render() {
  const el = document.getElementById('trades-ui'); if (!el || !ready) return;
  const team = +el.dataset.team;
  el.innerHTML = myTeam == null ? '<section class="panel"><div class="empty">Your account isn\'t linked to a team yet.</div></section>'
    : team === myTeam ? inbox() : builder(team) + `<div class="tr-inbox">${list.filter(t => [t.from, t.to].map(Number).includes(team) && ['offered', 'review'].includes(t.status)).map(card).join('')}</div>`;
  paintHelmets(el).catch(() => {});
}

document.addEventListener('change', e => {
  const c = e.target.closest('#trades-ui input[type=checkbox][data-side]'); if (!c) return;
  const s = sel[c.dataset.side]; c.checked ? s.add(c.value) : s.delete(c.value);
  const y = scrollY; render(); scrollTo(0, y);
});
document.addEventListener('click', async e => {
  const b = e.target.closest('#trades-ui [data-tr]'); if (!b) return;
  const a = b.dataset.tr, id = b.dataset.id, el = document.getElementById('trades-ui'), other = +el.dataset.team;
  if (a === 'send') {
    b.disabled = true;
    const data = { action: counterOf ? 'counter' : 'propose', id: counterOf, to: other, give: split('give'), get: split('get'), drops: [...sel.drops], note: document.getElementById('tr-note').value };
    if (await send(data, counterOf ? 'Counter offer sent.' : `Offer sent to ${tname(other)}.`)) { sel.give.clear(); sel.get.clear(); sel.drops.clear(); counterOf = null; render(); }
    b.disabled = false; return;
  }
  if (a === 'nocounter') { counterOf = null; sel.give.clear(); sel.get.clear(); render(); return; }
  if (a === 'counter') {
    const t = list.find(x => x.id === id); counterOf = id;
    sel.give = new Set([...t.get.players, ...t.get.picks.map(pkKey)]); sel.get = new Set([...t.give.players, ...t.give.picks.map(pkKey)]); sel.drops.clear();
    el.dataset.team = t.from; render(); scrollTo(0, el.getBoundingClientRect().top + scrollY - 120); return;
  }
  if (a === 'accept') {
    const t = list.find(x => x.id === id), me = M.teams[myTeam];
    const over = active(me).length - t.get.players.length + t.give.players.length - ACTIVE_MAX;
    const box = el.querySelector(`[data-box="${id}"]`);
    if (over > 0 && !box.querySelector('.tr-dropsel')) {
      box.insertAdjacentHTML('afterbegin', `<div class="tr-dropsel"><b>You'd have ${ACTIVE_MAX + over} active players. Pick ${over} to drop, then Accept again:</b><div class="tr-list">${active(me).filter(x => !t.get.players.includes(x)).map(x => `<label class="tr-item"><input type="checkbox" class="tr-acc-drop" value="${esc(x)}"><span class="pos ${esc(P(x).position)}">${esc(P(x).position)}</span><span>${esc(P(x).full_name)}</span></label>`).join('')}</div></div>`);
      return;
    }
    const drops = [...box.querySelectorAll('.tr-acc-drop:checked')].map(x => x.value);
    if (!confirm(`Accept this trade with ${tname(t.from)}? It goes into a two-day review, then goes through.`)) return;
    await send({ action: 'accept', id, drops }, 'Accepted. The trade goes through after its two-day review.'); return;
  }
  const msg = { reject: 'Offer rejected.', cancel: 'Offer withdrawn.', veto: 'Trade vetoed.' }[a];
  if (a === 'veto' && !confirm('Veto this trade? The rules allow it only for collusion or a rules violation (8-3-4).')) return;
  await send({ action: a, id }, msg);
});

addEventListener('hashchange', () => setTimeout(render, 0));
addEventListener('hub:moves', render);
new MutationObserver(() => { const el = document.getElementById('trades-ui'); if (el && !el.dataset.drawn) { el.dataset.drawn = '1'; render(); } }).observe(document.body, { childList: true, subtree: true });

onAuthStateChanged(auth, async user => {
  if (!user) return;
  M = await Hub.load();
  const [prof, roles] = await Promise.all([getDoc(doc(db, 'users', user.uid)).catch(() => null), getDoc(doc(db, 'config', 'roles')).catch(() => null)]);
  const t = ((prof && prof.data()) || {}).team; myTeam = t == null ? null : +t;
  commish = (((roles && roles.data()) || {}).commish || []).includes(user.uid);
  ready = true;
  if (myTeam != null) await load(); else render();
});
