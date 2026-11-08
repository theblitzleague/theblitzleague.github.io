/* Draft room (draftroom.html). The board, the clock, the player list, queues and the commissioner's controls.
   Everything shown comes straight from the database as it changes (onSnapshot); every action goes through the draft
   function (functions/index.js), which checks turns, the clock and the rules. This page only asks.
   ?d=<id> opens a draft; without it, the lobby lists drafts and (for the commissioner) sets up a new one.
   When the clock on screen hits zero, the page asks the server to make the automatic pick ("tick"); the server only
   does it if the time has really run out, so it doesn't matter how many people are watching. */
import { app, auth, db } from './fb.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { doc, getDoc, collection, query, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js';

const { esc, shot } = UI;
const call = httpsCallable(getFunctions(app, 'us-central1'), 'draft');
const $ = id => document.getElementById(id);
const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB'];
const NEED = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DL: 1, LB: 1, DB: 1 };
let M, me = null, commish = false, draftId = new URLSearchParams(location.search).get('d');
let D = null, pool = [], byId = {}, queue = [], skew = 0, unsub = [], qUnsub = null, ticking = -1, view = { pos: 'all', q: '', team: null, tab: 'players' };

const content = () => $('content');
const tName = id => { const t = M.teams[id]; return t ? t.f.location : `Team ${id}`; };
const tMark = id => (M.teams[id] ? markSVG(M.teams[id].f, 'mini') : '');
const short = n => { const p = n.split(' '); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : n; };
const mySeat = () => (D ? Object.keys(D.seats || {}).find(t => D.seats[t] === me.uid) : null);
const onClock = () => (D && D.teams.length ? D.teams[D.picks.length % D.teams.length] : null);
const left = () => (D && D.clockEnd ? Math.max(0, D.clockEnd - (Date.now() + skew)) : null);
const mmss = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function toast(msg, bad) {
  let el = $('dr-toast'); if (!el) { el = document.createElement('div'); el.id = 'dr-toast'; document.body.appendChild(el); }
  el.textContent = msg; el.className = bad ? 'bad' : ''; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3500);
}
async function act(data, quiet) {
  try { return (await call({ id: draftId, ...data })).data; } catch (e) { if (!quiet) toast(e.message.replace(/^.*?: /, ''), true); throw e; }
}

// ---------- lobby ----------
function lobby(list) {
  const teams = Object.values(M.teams).sort((a, b) => a.id - b.id);
  const row = d => `<a class="dr-lrow" href="draftroom.html?d=${d.id}"><b>${esc(d.name)}</b><span>${d.kind === 'rookie' ? 'Rookie' : 'Startup'} · ${d.rounds} rounds · ${d.teams.length} teams</span>
    <span class="dr-st ${esc(d.status)}">${d.status === 'done' ? `Done${d.official ? ' · official' : ''}` : d.status === 'setup' ? 'Not started' : d.status === 'paused' ? 'Paused' : `Live · pick ${d.picks.length + 1}`}</span></a>`;
  content().innerHTML = `<div class="grid">
    <section class="panel s12"><header><div><span class="eyebrow">The Blitz League's own draft room</span><h2>Drafts</h2></div></header>
      ${list.length ? `<div class="dr-lobby">${list.map(row).join('')}</div>` : '<div class="empty">No drafts yet.</div>'}
      <p class="footnote">Practice drafts are for testing: empty seats are drafted by the computer. The startup draft is 24 rounds in linear order, veterans and rookies already in the NFL (rule 8-2-1).</p></section>
    ${commish ? `<section class="panel s12"><header><div><span class="eyebrow">Commissioner</span><h2>New practice draft</h2></div></header>
      <form id="dr-new" class="dr-form">
        <label>Name <input name="name" maxlength="60" placeholder="Startup practice draft"></label>
        <label>Type <select name="kind"><option value="startup">Startup (24 rounds, all NFL players)</option><option value="rookie">Rookie (4 rounds, rookies only)</option></select></label>
        <label>Rounds <input name="rounds" type="number" min="1" max="30" value="24"></label>
        <label>Pick clock (seconds) <input name="clockSec" type="number" min="10" max="86400" value="120"></label>
        <label>Computer picks after (seconds) <input name="simDelay" type="number" min="1" max="60" value="2"></label>
        <label class="dr-check"><input name="shuffle" type="checkbox" checked> Random draft order (you can reorder before it starts)</label>
        <button class="btn primary" type="submit">Create draft</button>
      </form></section>` : ''}</div>`;
  const f = $('dr-new');
  if (f) {
    f.kind.addEventListener('change', () => { f.rounds.value = f.kind.value === 'rookie' ? 4 : 24; });
    f.addEventListener('submit', async e => {
      e.preventDefault(); const b = f.querySelector('button'); b.disabled = true; b.textContent = 'Creating…';
      let order = teams.map(t => t.id); if (f.shuffle.checked) order = order.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
      try { const r = await act({ action: 'create', name: f.name.value, kind: f.kind.value, rounds: f.rounds.value, clockSec: f.clockSec.value, simDelay: f.simDelay.value, teams: order });
        location.href = `draftroom.html?d=${r.id}`; } catch (err) { b.disabled = false; b.textContent = 'Create draft'; }
    });
  }
}

// ---------- the room ----------
function header() {
  const t = onClock(), seat = mySeat(), mine = seat && String(t) === seat;
  const round = D ? Math.floor(D.picks.length / D.teams.length) + 1 : 1, inRound = D.picks.length % D.teams.length + 1;
  const status = D.status === 'done' ? 'Draft complete' : D.status === 'setup' ? 'Waiting to start' : D.status === 'paused' ? 'Paused' : `Round ${round} · pick ${inRound} · overall ${D.picks.length + 1}`;
  return `<div class="dr-top${mine && D.status === 'live' ? ' mine' : ''}">
    <div class="dr-now">${D.status === 'live' || D.status === 'paused' ? `${tMark(t)}<div><span class="eyebrow">${mine ? 'You are on the clock' : 'On the clock'}</span><b>${esc(tName(t))}</b></div>` : `<div><span class="eyebrow">${esc(D.kind === 'rookie' ? 'Rookie draft' : 'Startup draft')}${D.practice ? ' · practice' : ''}</span><b>${esc(D.name)}</b></div>`}</div>
    <div class="dr-clock"><span id="dr-clock">${D.status === 'live' ? mmss(left()) : D.status === 'paused' ? mmss(D.pausedLeft || 0) : '--:--'}</span><small>${esc(status)}</small></div>
    <div class="dr-me">${seat ? `<span class="eyebrow">Your team</span><b>${tMark(seat)} ${esc(tName(seat))}</b>` : '<span class="eyebrow">Watching</span><b>No seat</b>'}</div>
  </div>
  ${commish ? `<div class="dr-commish"><span class="eyebrow">Commissioner</span>
    ${D.status === 'setup' ? '<button class="btn primary" data-a="start">Start draft</button>' : ''}
    ${D.status === 'live' ? '<button class="btn" data-a="pause">Pause</button>' : ''}${D.status === 'paused' ? '<button class="btn primary" data-a="resume">Resume</button>' : ''}
    ${D.picks.length ? '<button class="btn" data-a="undo">Undo last pick</button>' : ''}
    ${D.status === 'done' ? `<button class="btn" data-a="official">${D.official ? 'Unmark official' : 'Mark as official'}</button>` : ''}
    <button class="btn danger" data-a="delete">Delete draft</button>
    <label>Seat <select id="dr-seat"><option value="">Pick a team to sit at…</option>${D.teams.map(t => `<option value="${t}"${String(t) === seat ? ' selected' : ''}>${esc(tName(t))}${D.seats[t] && D.seats[t] !== me.uid ? ' (taken)' : ''}</option>`).join('')}</select></label>
    ${D.status === 'setup' ? `<label>Clock <input id="dr-clocks" type="number" min="10" value="${D.clockSec}"> s</label><button class="btn" data-a="shuffle">Shuffle order</button>` : `<span class="pmeta">Clock ${D.clockSec}s · computer ${D.simDelay}s</span>`}
  </div>` : !seat && D.practice && D.status !== 'done' ? `<div class="dr-commish"><label>Take a seat <select id="dr-seat"><option value="">…</option>${D.teams.filter(t => !D.seats[t]).map(t => `<option value="${t}">${esc(tName(t))}</option>`).join('')}</select></label></div>` : ''}`;
}

function board() {
  const T = D.teams.length, cur = D.status === 'done' ? -1 : D.picks.length;
  let rows = '';
  for (let r = 0; r < D.rounds; r++) {
    rows += `<tr><th>${r + 1}</th>${D.teams.map((t, c) => {
      const n = r * T + c, p = D.picks[n], e = p && byId[p.p];
      if (p) return `<td class="dr-cell p-${esc(e ? e.pos : '')}" data-pid="${esc(p.p)}"><b>${esc(e ? short(e.name) : p.p)}</b><small>${esc(e ? `${e.pos} · ${e.team}` : '')}${p.by === 'auto' ? ' · auto' : ''}</small></td>`;
      return `<td class="dr-cell${n === cur ? ' now' : ''}"><small>${r + 1}.${String(c + 1).padStart(2, '0')}</small></td>`;
    }).join('')}</tr>`;
  }
  return `<div class="tablewrap dr-boardwrap"><table class="dr-board"><thead><tr><th></th>${D.teams.map(t => `<th${String(t) === mySeat() ? ' class="me"' : ''}>${tMark(t)}<span>${esc(M.teams[t] ? M.teams[t].f.abbr || tName(t) : t)}</span></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function available() {
  const taken = new Set(D.picks.map(p => p.p)), q = view.q.trim().toLowerCase();
  const seat = mySeat(), t = onClock(), can = D.status === 'live' && (commish || (seat && String(t) === seat));
  const list = pool.filter(e => !taken.has(e.id) && (view.pos === 'all' || e.pos === view.pos) && (!q || e.name.toLowerCase().includes(q) || e.team.toLowerCase() === q));
  const inQ = new Set(queue);
  return `<div class="dr-tools"><input id="dr-q" type="search" placeholder="Search players or NFL team" value="${esc(view.q)}" autocomplete="off">
    <div class="nw-filter">${['all', ...POS].map(p => `<button data-dpos="${p}" aria-pressed="${view.pos === p}">${p === 'all' ? 'All' : p}</button>`).join('')}</div></div>
    <div class="dr-list">${list.slice(0, 150).map(e => `<div class="dr-pl"><span class="rk">${e.rank + 1}</span><span class="nw-who" data-pid="${esc(e.id)}">${shot(e.id, 'nw-shot')}<span><b>${esc(e.name)}</b><small><span class="pos ${esc(e.pos)}">${esc(e.pos)}</span> ${esc(e.team)}</small></span></span>
      <span class="dr-ppg">${e.ppg ? e.ppg.toFixed(1) : '-'}<small>pts/g</small></span>
      ${seat ? `<button class="btn dr-q${inQ.has(e.id) ? ' on' : ''}" data-queue="${esc(e.id)}" title="${inQ.has(e.id) ? 'Remove from queue' : 'Add to queue'}">${inQ.has(e.id) ? '✓ Q' : '+ Q'}</button>` : ''}
      ${can ? `<button class="btn primary" data-draft="${esc(e.id)}">Draft</button>` : ''}</div>`).join('') || '<div class="empty">No players match.</div>'}</div>
    <p class="footnote">Ranked by points per game this season in Blitz League scoring (fewer than 3 games counts for less). ${can && !(seat && String(t) === seat) ? 'As commissioner you can pick for the team on the clock.' : ''}</p>`;
}

function queuePanel() {
  const seat = mySeat(); if (!seat) return '<div class="empty">Take a seat to keep a queue.</div>';
  const taken = new Set(D.picks.map(p => p.p));
  const list = queue.filter(id => !taken.has(id));
  return list.length ? `<ol class="dr-queue">${list.map((id, i) => { const e = byId[id] || { name: id, pos: '', team: '' };
    return `<li><span class="nw-who" data-pid="${esc(id)}"><span><b>${esc(e.name)}</b><small><span class="pos ${esc(e.pos)}">${esc(e.pos)}</span> ${esc(e.team)}</small></span></span>
      <span class="dr-qbtn">${i ? `<button class="btn" data-qup="${esc(id)}" aria-label="Move up">▲</button>` : ''}<button class="btn" data-queue="${esc(id)}" aria-label="Remove">✕</button></span></li>`; }).join('')}</ol>
    <p class="footnote">If your clock runs out, the first player still available here is drafted for you; with an empty queue, the best available player.</p>`
    : '<div class="empty">Your queue is empty. Add players with "+ Q".</div>';
}

function roster() {
  const t = view.team || mySeat() || onClock() || D.teams[0];
  const picks = D.picks.map((p, n) => ({ ...p, n })).filter(p => String(p.t) === String(t));
  const by = {}; for (const p of picks) { const e = byId[p.p]; (by[e ? e.pos : '?'] = by[e ? e.pos : '?'] || []).push({ p, e }); }
  return `<label class="dr-rsel">Team <select id="dr-team">${D.teams.map(x => `<option value="${x}"${String(x) === String(t) ? ' selected' : ''}>${esc(tName(x))}</option>`).join('')}</select></label>
    <div class="dr-roster">${POS.map(pos => `<div><div class="sub"><span class="pos ${pos}">${pos}</span> ${(by[pos] || []).length}${NEED[pos] && (by[pos] || []).length < NEED[pos] ? ` <small class="dr-need">need ${NEED[pos] - (by[pos] || []).length}</small>` : ''}</div>
      ${(by[pos] || []).map(({ p, e }) => `<div class="dr-rp" data-pid="${esc(p.p)}"><b>${esc(e ? e.name : p.p)}</b><small>${esc(e ? e.team : '')} · ${Math.floor(p.n / D.teams.length) + 1}.${String(p.n % D.teams.length + 1).padStart(2, '0')}</small></div>`).join('')}</div>`).join('')}</div>
    <p class="footnote">${picks.length} of ${D.rounds} picks. Starting lineup needs 1 QB, 2 RB, 2 WR, 1 TE, 1 K, 1 DL, 1 LB, 1 DB plus flex spots (rule 7-2-1). Most 2 QBs (8-1-4).</p>`;
}

function recent() {
  return D.picks.slice(-10).reverse().map((p, i) => { const n = D.picks.length - 1 - i, e = byId[p.p];
    return `<div class="dr-rec"><span class="rk">${Math.floor(n / D.teams.length) + 1}.${String(n % D.teams.length + 1).padStart(2, '0')}</span>${tMark(p.t)}<span data-pid="${esc(p.p)}"><b>${esc(e ? e.name : p.p)}</b><small>${esc(e ? `${e.pos} · ${e.team}` : '')} · ${esc(tName(p.t))}${p.by === 'auto' ? ' · auto' : p.by === 'sim' ? ' · computer' : ''}</small></span></div>`; }).join('') || '<div class="empty">No picks yet.</div>';
}

function render() {
  if (!D) return;
  const keep = document.activeElement && document.activeElement.id === 'dr-q';
  const tabs = [['players', 'Players'], ['queue', `Queue${mySeat() ? ` (${queue.filter(id => !D.picks.some(p => p.p === id)).length})` : ''}`], ['roster', 'Rosters'], ['board', 'Board']];
  content().innerHTML = `<div class="dr">${header()}
    <div class="dr-tabs" role="tablist">${tabs.map(([k, l]) => `<button data-tab="${k}" aria-selected="${view.tab === k}">${l}</button>`).join('')}</div>
    <div class="dr-grid t-${view.tab}">
      <section class="panel dr-main"><header><div><h2>Board</h2></div><a class="aside" href="draftroom.html">All drafts</a></header>${board()}</section>
      <section class="panel dr-side dr-avail"><header><div><h2>Players</h2></div></header>${available()}</section>
      <section class="panel dr-side dr-qp"><header><div><h2>Your queue</h2></div></header>${queuePanel()}</section>
      <section class="panel dr-side dr-rost"><header><div><h2>Rosters</h2></div></header>${roster()}</section>
      <section class="panel dr-side dr-recent"><header><div><h2>Latest picks</h2></div></header>${recent()}</section>
    </div></div>`;
  if (keep) { const q = $('dr-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  paintHelmets(content()).catch(() => {});
  // Keep the pick on the clock in view inside the board (scrolls the board only, never the page).
  const cell = content().querySelector('.dr-cell.now'), wrap = content().querySelector('.dr-boardwrap');
  if (cell && wrap && render.lastN !== D.picks.length) { wrap.scrollLeft = Math.max(0, cell.offsetLeft - wrap.clientWidth / 2); wrap.scrollTop = Math.max(0, cell.offsetTop - 60); }
  render.lastN = D.picks.length;
}
// Redraw just the player list while typing a search, so the box keeps focus.
function renderList() { const s = content().querySelector('.dr-avail'); if (s) { s.innerHTML = `<header><div><h2>Players</h2></div></header>${available()}`; const q = $('dr-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); paintHelmets(s).catch(() => {}); } }

function clockLoop() {
  setInterval(() => {
    if (!D || D.status !== 'live') return;
    const ms = left(), el = $('dr-clock'); if (el) { el.textContent = mmss(ms); el.classList.toggle('low', ms < 10000); }
    // Time's up: ask the server for the automatic pick (once per pick from this page; the server double-checks the time).
    if (ms <= 0 && ticking !== D.picks.length) { ticking = D.picks.length; act({ action: 'tick' }, true).catch(() => { setTimeout(() => { ticking = -1; }, 3000); }); }
  }, 250);
}

function openDraft() {
  unsub.forEach(u => u()); unsub = [];
  getDoc(doc(db, 'drafts', draftId, 'pool', 'all')).then(s => {
    pool = (s.data() || { list: [] }).list.map((x, rank) => { const [id, pos, name, team, ppg] = x.split('|'); return { id, pos, name, team, ppg: +ppg, rank }; });
    byId = Object.fromEntries(pool.map(e => [e.id, e])); render();
  });
  unsub.push(onSnapshot(doc(db, 'drafts', draftId), s => {
    if (!s.exists()) { content().innerHTML = '<div class="empty">This draft was deleted. <a href="draftroom.html">All drafts</a></div>'; return; }
    D = s.data();
    const seat = mySeat();
    if (qUnsub && qUnsub.team !== seat) { qUnsub(); qUnsub = null; queue = []; }
    if (seat && !qUnsub) { qUnsub = onSnapshot(doc(db, 'drafts', draftId, 'queues', seat), q => { queue = (q.data() || {}).list || []; render(); }, () => {}); qUnsub.team = seat; }
    render();
  }, e => { content().innerHTML = `<div class="error">Couldn't open this draft (${esc(e.message)}).</div>`; }));
}

function wire() {
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-a], [data-draft], [data-queue], [data-qup], [data-dpos], [data-tab]'); if (!b) return;
    if (b.dataset.tab) { view.tab = b.dataset.tab; render(); return; }
    if (b.dataset.dpos) { view.pos = b.dataset.dpos; render(); return; }
    if (b.dataset.draft) { const e2 = byId[b.dataset.draft]; b.disabled = true; try { await act({ action: 'pick', n: D.picks.length, player: b.dataset.draft }); toast(`Drafted ${e2 ? e2.name : ''}`); } catch (err) { b.disabled = false; } return; }
    if (b.dataset.queue || b.dataset.qup) {
      const id = b.dataset.queue || b.dataset.qup; let list = queue.slice();
      if (b.dataset.qup) { const i = list.indexOf(id); if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]]; }
      else list = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
      queue = list; render();
      act({ action: 'queue', team: mySeat(), list }).catch(() => {}); return;
    }
    const a = b.dataset.a;
    if (a === 'delete' && !confirm('Delete this draft for everyone? This cannot be undone.')) return;
    if (a === 'undo' && !confirm('Undo the last pick?')) return;
    if (a === 'shuffle') { const t = D.teams.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(x => x[1]); await act({ action: 'setup', teams: t }).catch(() => {}); return; }
    b.disabled = true;
    try { await act({ action: a, on: a === 'official' ? !D.official : undefined }); if (a === 'delete') location.href = 'draftroom.html'; } catch (err) { /* toast shown */ } finally { b.disabled = false; }
  });
  document.addEventListener('input', e => { if (e.target.id === 'dr-q') { view.q = e.target.value; renderList(); } });
  document.addEventListener('change', e => {
    if (e.target.id === 'dr-team') { view.team = e.target.value; render(); }
    if (e.target.id === 'dr-seat' && e.target.value) act({ action: 'seat', team: e.target.value }).catch(() => {});
    if (e.target.id === 'dr-clocks') act({ action: 'setup', clockSec: e.target.value }).catch(() => {});
  });
}

UI.boot('<a href="draft.html">Draft</a> · <strong>Draft room</strong>', async model => {
  M = model;
  content().innerHTML = '<div class="loading">Signing in…</div>';
  onAuthStateChanged(auth, async user => {
    me = user;
    if (!user) { content().innerHTML = `<section class="panel"><div class="empty">The draft room is for League members. <a href="account.html">Sign in</a> first.</div></section>`; return; }
    commish = (((await getDoc(doc(db, 'config', 'roles')).catch(() => null))?.data() || {}).commish || []).includes(user.uid);
    if (draftId) { openDraft(); return; }
    onSnapshot(query(collection(db, 'drafts'), orderBy('created', 'desc'), limit(20)), s => lobby(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => { content().innerHTML = `<div class="error">Couldn't load drafts (${esc(e.message)}).</div>`; });
  });
  // This device's clock may be off; the countdown uses the web server's time (the Date header) instead.
  fetch(location.href, { method: 'HEAD', cache: 'no-store' }).then(r => { const t = Date.parse(r.headers.get('date')); if (t) skew = t + 500 - Date.now(); }).catch(() => {});
  wire(); clockLoop();
});
