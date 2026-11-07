/* The League ledger (rule 6-4-3), shown on Awards › Prizes & Ledger. Loaded by js/awards.js on devices where someone
   has signed in. Members (the commissioners and every GM linked to a team) can read it; only the League's owner can
   record anything, and nothing is ever edited or deleted: a mistake is cancelled with a "void" entry. firestore.rules
   enforces all of that; this page only hides buttons people can't use.
   Entries (ledger/{id}): kind dues | prepay | payout | void, season, team, amount, prize, week, note, ref (void only). */
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { doc, getDoc, collection, query, where, onSnapshot, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { auth, db } from './fb.js';

const { esc, teamName, money } = UI;
const VENMO = 'gwilso22';
const user = new Promise(res => { const stop = onAuthStateChanged(auth, u => { stop(); res(u); }); });
let unsub = null;

const PRIZES = { weekly: 'Weekly high score', champion: 'Champion', runnerUp: 'Runner-up', third: 'Third place', division: 'Division winner', pointsLeader: 'Points leader', gmOfYear: 'GM of the Year' };
const dateOf = e => (e.at && e.at.toDate ? e.at.toDate() : null);
const day = d => (d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'saving…');

export async function mount(el, M) {
  if (unsub) { unsub(); unsub = null; }
  const u = await user;
  if (!u) { el.innerHTML = gate('Members only', 'Sign in on the <a href="account.html">Account</a> page to see the League ledger.'); return; }
  const [roles, me] = await Promise.all([getDoc(doc(db, 'config', 'roles')).catch(() => null), getDoc(doc(db, 'users', u.uid)).catch(() => null)]);
  const r = roles && roles.exists() ? roles.data() : {};
  const owner = r.owner === u.uid, member = (r.commish || []).includes(u.uid) || !!(me && me.exists() && me.data().team);
  if (!member) { el.innerHTML = gate('Members only', "The ledger is for league members. Once the commissioner links your account to your team, it appears here."); return; }
  const season = Number(M.league.duesSeason) || Number(M.state.season);
  el.innerHTML = '<div class="loading">Loading the ledger</div>';
  unsub = onSnapshot(query(collection(db, 'ledger'), where('season', '>=', season - 1)), s => {
    const all = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ((dateOf(b) || new Date(8.64e15)) - (dateOf(a) || new Date(8.64e15))));
    render(el, M, all, season, owner);
  }, e => { el.innerHTML = gate("Couldn't load the ledger", esc(String(e.code || e.message || e))); });
}

const gate = (title, body) => `<section class="panel s12 ledger"><header><div><span class="eyebrow">League ledger · rule 6-4-3</span><h2>${esc(title)}</h2></div></header><p>${body}</p></section>`;

function render(el, M, all, season, owner) {
  const voided = new Set(all.filter(e => e.kind === 'void').map(e => e.ref));
  const live = all.filter(e => e.kind !== 'void' && !voided.has(e.id));
  const teams = Object.values(M.teams).sort((a, b) => teamName(a).localeCompare(teamName(b)));
  const z = UI.prizes(M), dues = z.buyIn || 100;
  const paidDues = {};
  live.filter(e => e.kind === 'dues' && e.season === season).forEach(e => { paidDues[e.team] = e; });
  const prepaid = live.filter(e => e.kind === 'prepay');
  const inThis = live.filter(e => (e.kind === 'dues' || e.kind === 'prepay') && e.season === season).reduce((n, e) => n + e.amount, 0);
  const outThis = live.filter(e => e.kind === 'payout' && e.season === season).reduce((n, e) => n + e.amount, 0);
  const pot = dues * teams.length;
  const weekly = M.live ? UI.weeklyWinners(M) : [];
  const paidWeek = (w, t) => live.find(e => e.kind === 'payout' && e.prize === 'weekly' && e.week === w && e.team === t && e.season === season);
  const btn = (label, data) => (owner ? `<button class="btn small" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(String(v))}"`).join(' ')}>${label}</button>` : '');

  el.innerHTML = `<div class="grid ledger">
    <section class="panel s12"><header><div><span class="eyebrow">League ledger · ${season} season · rule 6-4-3</span><h2>Money in and out</h2></div>
      <span class="aside">${owner ? '<button class="btn small" id="lg-csv">Export CSV</button>' : 'Recorded by the commissioner'}</span></header>
      <div class="lg-stats">
        <div><span class="pmeta">Dues collected</span><b>${money(inThis)}</b><small>of ${money(pot)}</small></div>
        <div><span class="pmeta">Paid out</span><b>${money(outThis)}</b><small>prizes so far</small></div>
        <div><span class="pmeta">On hand</span><b>${money(inThis - outThis)}</b><small>held for prizes</small></div>
        <div><span class="pmeta">Teams paid</span><b>${Object.keys(paidDues).length} / ${teams.length}</b><small>${season} dues</small></div>
      </div></section>

    <section class="panel s4 lg-pay"><header><div><span class="eyebrow">Pay your dues</span><h2>Venmo @${VENMO}</h2></div></header>
      <a href="https://venmo.com/u/${VENMO}" target="_blank" rel="noopener"><img src="assets/league/venmo-qr.png" alt="Venmo QR code for @${VENMO}" width="220" height="220"></a>
      <p>${money(dues)} per season, sent as <b>Friends &amp; Family</b> with the note <b>"Blitz League dues ${season}"</b> (6-1-1).</p>
      <p class="pmeta">Scan with your phone's camera or the Venmo app, or tap the code.</p></section>

    <section class="panel s8"><header><div><span class="eyebrow">${season} season</span><h2>Dues</h2></div></header>
      <div class="tablewrap"><table class="st"><thead><tr><th>Team</th><th>Status</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${teams.map(t => { const p = paidDues[t.id]; return `<tr><td>${esc(teamName(t))}</td>
        <td>${p ? `<span class="tag ok">Paid</span> <span class="pmeta">${day(dateOf(p))}</span>` : '<span class="tag out">Unpaid</span>'}</td>
        <td class="num">${p ? money(p.amount) : '-'}</td><td class="num">${p ? '' : btn('Mark paid', { act: 'dues', team: t.id })}</td></tr>`; }).join('')}
      </tbody></table></div>
      ${prepaid.length ? `<div class="sub">Future-season prepayments (8-3-5)</div><p class="pmeta">${prepaid.map(e => `${esc(teamName(M.teams[e.team] || { f: { location: 'Team ' + e.team } }))}: ${money(e.amount)} toward ${e.season}`).join(' · ')}</p>` : ''}
      ${owner ? `<div class="acct-row">${btn('Record a prepayment', { act: 'prepay' })}${btn('Record a prize payout', { act: 'payout' })}</div>` : ''}</section>

    ${z.weekly ? `<section class="panel s12"><header><div><span class="eyebrow">${money(z.weekly)} a week · paid within 7 days (6-4-1)</span><h2>Weekly prizes</h2></div></header>
      ${weekly.length ? `<div class="tablewrap"><table class="st"><thead><tr><th>Week</th><th>Winner</th><th class="num">Prize</th><th>Status</th></tr></thead><tbody>
        ${weekly.flatMap(w => w.winners.map(t => { const p = paidWeek(w.week, t.id); return `<tr><td class="rank">W${w.week}</td><td>${esc(teamName(t))}</td><td class="num">${money(w.each)}</td>
          <td>${p ? `<span class="tag ok">Paid</span> <span class="pmeta">${day(dateOf(p))}</span>` : `<span class="tag q">Owed</span> ${btn('Pay out', { act: 'week', team: t.id, week: w.week, amount: w.each })}`}</td></tr>`; })).join('')}
      </tbody></table></div>` : `<p class="empty">Weekly prizes appear here once the league's real season is under way.</p>`}</section>` : ''}

    <section class="panel s12"><header><div><span class="eyebrow">Every entry, newest first</span><h2>Ledger history</h2></div></header>
      ${all.length ? `<div class="tablewrap"><table class="st lg-hist"><thead><tr><th>Date</th><th>Entry</th><th>Team</th><th class="num">In</th><th class="num">Out</th><th></th></tr></thead><tbody>
      ${all.map(e => { const t = M.teams[e.team], gone = voided.has(e.id), isVoid = e.kind === 'void';
        const what = isVoid ? `Void: ${esc(e.note || '')}` : e.kind === 'dues' ? `${e.season} dues` : e.kind === 'prepay' ? `${e.season} dues prepaid (8-3-5)` : `${esc(PRIZES[e.prize] || e.prize || 'Prize')}${e.week ? ` · Week ${e.week}` : ''}`;
        return `<tr class="${gone ? 'lg-void' : ''}"><td class="pmeta">${day(dateOf(e))}</td><td>${what}${e.note && !isVoid ? `<div class="pmeta">${esc(e.note)}</div>` : ''}${gone ? '<div class="pmeta">Voided</div>' : ''}</td>
          <td>${t ? esc(teamName(t)) : '-'}</td><td class="num">${!isVoid && e.kind !== 'payout' ? money(e.amount) : ''}</td><td class="num">${e.kind === 'payout' ? money(e.amount) : ''}</td>
          <td class="num">${!isVoid && !gone ? btn('Void', { act: 'void', id: e.id }) : ''}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="empty">Nothing recorded yet.</p>'}
      <p class="pmeta">Entries can't be edited or deleted, by anyone. A mistake is cancelled with a void entry, which stays in the history.</p></section>
  </div>`;
  if (owner) wire(el, M, all, season, dues);
}

function wire(el, M, all, season, dues) {
  const add = async data => {
    try { await addDoc(collection(db, 'ledger'), { season, team: null, prize: null, week: null, note: null, ...data, by: auth.currentUser.uid, at: serverTimestamp() }); }
    catch (e) { alert(`Couldn't save that entry (${e.code || e.message}).`); }
  };
  const teamPick = msg => { const list = Object.values(M.teams).map(t => `${t.id}: ${teamName(t)}`).join('\n'); const v = prompt(`${msg}\n\n${list}\n\nTeam number:`); return v && M.teams[+v] ? +v : null; };
  const amountPick = (msg, def) => { const v = prompt(msg, String(def)); const n = Number(v); return v != null && n > 0 && n <= 2000 ? n : null; };
  for (const b of el.querySelectorAll('[data-act]')) b.onclick = async () => {
    const a = b.dataset.act;
    if (a === 'dues') {
      const t = M.teams[+b.dataset.team], amt = amountPick(`${teamName(t)}: ${season} dues received. Amount:`, dues);
      if (amt && confirm(`Record ${money(amt)} ${season} dues from ${teamName(t)}? Entries can't be edited later.`)) add({ kind: 'dues', team: t.id, amount: amt });
    } else if (a === 'week') {
      const t = M.teams[+b.dataset.team], amt = +b.dataset.amount;
      if (confirm(`Record ${money(amt)} paid to ${teamName(t)} for Week ${b.dataset.week}'s high score?`)) add({ kind: 'payout', prize: 'weekly', week: +b.dataset.week, team: t.id, amount: amt });
    } else if (a === 'prepay') {
      const team = teamPick('Prepayment for trading a future pick (8-3-5). Which team?'); if (!team) return;
      const s = Number(prompt('Toward which season\'s dues?', String(season + 1))); if (!(s > season && s < season + 5)) return;
      const amt = amountPick('Amount received:', 50);
      if (amt && confirm(`Record ${money(amt)} from ${teamName(M.teams[team])} toward ${s} dues?`)) add({ kind: 'prepay', season: s, team, amount: amt });
    } else if (a === 'payout') {
      const key = prompt(`Which prize? Type one of: ${Object.keys(PRIZES).filter(k => k !== 'weekly').join(', ')}`); if (!PRIZES[key] || key === 'weekly') return;
      const team = teamPick(`${PRIZES[key]}: paid to which team?`); if (!team) return;
      const z = UI.prizes(M), amt = amountPick('Amount paid:', z[key] || 0);
      if (amt && confirm(`Record ${money(amt)} ${PRIZES[key]} paid to ${teamName(M.teams[team])}?`)) add({ kind: 'payout', prize: key, team, amount: amt });
    } else if (a === 'void') {
      const e = all.find(x => x.id === b.dataset.id); if (!e) return;
      const why = prompt('Why is this entry being voided? (shown to members)'); if (!why || !why.trim()) return;
      if (confirm('Void this entry? It stays in the history, struck through, and stops counting toward totals.')) add({ kind: 'void', season: e.season, team: e.team ?? null, amount: 0, ref: e.id, note: why.trim().slice(0, 300) });
    }
  };
  const csv = el.querySelector('#lg-csv');
  if (csv) csv.onclick = () => {
    const rows = [['date', 'kind', 'season', 'team', 'prize', 'week', 'amount', 'note', 'id', 'voids']].concat(all.slice().reverse().map(e => [
      (dateOf(e) || new Date()).toISOString(), e.kind, e.season, e.team != null && M.teams[e.team] ? teamName(M.teams[e.team]) : '', e.prize || '', e.week || '', e.amount, e.note || '', e.id, e.ref || '']));
    const text = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = `blitz-league-ledger-${season}.csv`; a.click();
  };
}
