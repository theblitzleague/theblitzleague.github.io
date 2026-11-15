/* All trades, for the commissioner (Account page). Every trade between any two teams, newest first, with what the
   commissioner can do about it (rule 4-1; each one is logged as a Commissioner transaction, 11-2-1):
     open offer      Accept for the receiving team (two-day review, then the Wednesday batch), Reject for it, or Push
                     through now (accepted and processed at once).
     in review       Push through now (skips the rest of the review and the batch), or Veto (8-3-4).
   Everything goes through the "trades" function (functions/index.js), which still checks dues (6-1-3), the deadline
   (8-3-3), prepaid picks (8-3-5) and the rosters. The batch's last run (config/movesRun) shows at the top. */
import { collection, query, orderBy, limit, onSnapshot, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js';
import { app, db } from './fb.js';

const { esc } = UI;
const call = httpsCallable(getFunctions(app, 'us-central1'), 'trades');

export function commishTrades(M, box) {
  const P = id => M.players[id] || { full_name: `Player ${id}`, position: '?' };
  const tname = id => (M.teams[id] ? M.teams[id].f.location : `Team ${id}`);
  const when = ms => (ms ? new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const assets = a => [...((a || {}).players || []).map(id => `${esc(P(id).position)} ${esc(P(id).full_name)}`),
    ...((a || {}).picks || []).map(p => `${esc(tname(p.roster_id))}'s ${p.season} round ${p.round} pick`)].join(', ') || 'nothing';
  const label = { offered: 'Waiting on the receiving team', review: 'In review', processed: 'Done', rejected: 'Rejected', cancelled: 'Withdrawn', countered: 'Countered', vetoed: 'Vetoed', failed: 'Failed' };
  let list = [];

  box.innerHTML = `<section class="panel s12"><header><div><span class="eyebrow">Commissioner</span><h2>All trades</h2></div><span class="aside" id="ct-n"></span></header>
    <p class="acct-note">Every trade in the league. You can accept or reject an open offer for the team it was sent to, push a trade through now
      instead of waiting for the review and the Wednesday batch, or veto one in review. Dues, the deadline, prepaid picks and roster limits are still checked,
      and each action is logged as a Commissioner transaction.</p>
    <p class="pmeta" id="ct-batch">Wednesday batch: checking…</p>
    <div class="acct-row"><label><input type="checkbox" id="ct-all"> Show finished trades too</label></div>
    <div id="ct-list" class="acct-list"><p class="pmeta">Loading…</p></div><p class="pmeta" id="ct-msg"></p></section>`;
  const $ = id => box.querySelector('#' + id);
  const say = (m, bad) => { $('ct-msg').textContent = m; $('ct-msg').className = 'pmeta' + (bad ? ' bad' : ''); };

  getDoc(doc(db, 'config', 'movesRun')).then(s => {
    const L = s.exists() ? s.data() : null;
    $('ct-batch').textContent = !L ? 'Wednesday batch: it hasn\'t run yet. The first run is the next Wednesday at 3 AM Central.'
      : L.error && (L.lastError || 0) > (L.lastOk || 0) ? `Wednesday batch: the last run FAILED ${when(L.lastError)} (${L.error}).`
      : `Wednesday batch: last ran ${when(L.lastOk)}: ${L.trades} trade${L.trades === 1 ? '' : 's'}, ${L.waivers} waiver player${L.waivers === 1 ? '' : 's'} settled.`;
  }).catch(() => { $('ct-batch').textContent = 'Wednesday batch: couldn\'t read its status.'; });

  const render = () => {
    const all = $('ct-all').checked, shown = list.filter(t => all || ['offered', 'review'].includes(t.status));
    $('ct-n').textContent = `${list.filter(t => ['offered', 'review'].includes(t.status)).length} open`;
    $('ct-list').innerHTML = shown.map(t => {
      const btns = t.status === 'offered'
        ? `<button class="btn primary small" data-ct="accept" data-id="${t.id}">Accept for ${esc(tname(t.to))}</button><button class="btn small" data-ct="push" data-id="${t.id}">Push through now</button><button class="btn danger small" data-ct="reject" data-id="${t.id}">Reject for ${esc(tname(t.to))}</button>`
        : t.status === 'review'
        ? `<button class="btn primary small" data-ct="push" data-id="${t.id}">Push through now</button><button class="btn danger small" data-ct="veto" data-id="${t.id}">Veto</button>` : '';
      const drops = [...(t.dropsFrom || []), ...(t.dropsTo || [])];
      return `<div class="acct-item"><div><b>${esc(tname(t.from))} ⇄ ${esc(tname(t.to))}</b> <span class="tag">${esc(label[t.status] || t.status)}</span>
        <p>${esc(tname(t.from))} sends: ${assets(t.give)}<br>${esc(tname(t.to))} sends: ${assets(t.get)}${drops.length ? `<br>Drops: ${drops.map(id => esc(P(id).full_name)).join(', ')}` : ''}</p>
        <span class="pmeta">Offered ${when(t.at)}${t.status === 'review' ? ` · goes through ${when(t.processAt || t.reviewUntil)}` : ''}${t.done ? ` · ${when(t.done)}` : ''}${t.pushedBy ? ' · pushed by the commissioner' : ''}${t.note && ['failed', 'vetoed'].includes(t.status) ? ` · ${esc(t.note)}` : ''}</span>
        ${btns ? `<div class="acct-row">${btns}</div>` : ''}</div></div>`;
    }).join('') || `<p class="empty">${all ? 'No trades yet.' : 'No open offers or trades in review.'}</p>`;
  };
  $('ct-all').onchange = render;
  onSnapshot(query(collection(db, 'trades'), orderBy('at', 'desc'), limit(100)), s => { list = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); },
    e => { $('ct-list').innerHTML = `<p class="bad">Couldn't load trades (${esc(e.message)}).</p>`; });

  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-ct]'); if (!b) return;
    const a = b.dataset.ct, t = list.find(x => x.id === b.dataset.id); if (!t) return;
    const pair = `${tname(t.from)} ⇄ ${tname(t.to)}`;
    const ask = {
      accept: `Accept this trade for ${tname(t.to)}?\n\n${pair}\n\nIt goes into the two-day review, then through in the next Wednesday 3 AM batch.`,
      push: `Push this trade through NOW?\n\n${pair}\n\nPlayers and picks move immediately${t.status === 'offered' ? `, accepted for ${tname(t.to)}` : ''}. This can't be undone except by another trade.`,
      reject: `Reject this offer for ${tname(t.to)}?\n\n${pair}`,
      veto: `Veto this trade?\n\n${pair}\n\nThe rules allow a veto only for collusion or a rules violation (8-3-4).`,
    }[a];
    if (!confirm(ask)) return;
    for (const x of box.querySelectorAll('[data-ct]')) x.disabled = true;
    say(a === 'push' ? 'Pushing it through…' : 'Working…');
    try {
      await call({ action: a, id: t.id });
      say({ accept: `Accepted for ${tname(t.to)}. It goes through in the next Wednesday batch.`, push: `Done: ${pair} went through.`, reject: 'Offer rejected.', veto: 'Trade vetoed.' }[a]);
    } catch (err) { say(err.message.replace(/^.*?: /, ''), true); }
    render();
  });
}
