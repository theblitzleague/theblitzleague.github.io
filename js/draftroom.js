/* Draft room (draftroom.html). The board, the clock, the player list, queues and the commissioner's controls.
   Everything shown comes straight from the database as it changes (onSnapshot); every action goes through the draft
   function (functions/index.js), which checks turns, the clock and the rules. This page only asks.
   ?d=<id> opens a draft; without it, the lobby lists drafts and (for the commissioner) sets up a new one.
   Seats: a GM sits at the team the commissioner linked to their account (Account page), automatically on opening the
   room. Only the commissioner can move people between seats.
   Each part of the room (header, board, players, queue, rosters, latest picks) is redrawn on its own and only when what
   it shows changed, keeping its scroll position, so nothing jumps when someone else drafts.
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
let M, me = null, commish = false, myTeam = null, draftId = new URLSearchParams(location.search).get('d');
let D = null, pool = [], byId = {}, Q = { list: [], auto: true }, byes = {}, skew = 0, qUnsub = null, ticking = -1, joined = false;
const view = { pos: 'all', q: '', team: null, tab: 'players', limit: 200 };

const content = () => $('content');
const tName = id => { const t = M.teams[id]; return t ? t.f.location : `Team ${id}`; };
const tMark = id => (M.teams[id] ? markSVG(M.teams[id].f, 'mini') : '');
const short = n => { const p = n.split(' '); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : n; };
// My seat: the team I sit at (one person per franchise).
const mySeat = () => (D ? Object.keys(D.seats || {}).find(t => D.seats[t] === me.uid) || null : null);
// Rookie drafts follow pick ownership (D.owners, set when the draft starts: traded picks go to their new owners).
const ownerAt = n => (D.owners && D.owners.length ? D.owners[n] : D.teams[n % D.teams.length]);
const onClock = () => (D && D.teams.length ? ownerAt(D.picks.length) : null);
const left = () => (D && D.clockEnd ? Math.max(0, D.clockEnd - (Date.now() + skew)) : null);
const mmss = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const slot = n => `${Math.floor(n / D.teams.length) + 1}.${String(n % D.teams.length + 1).padStart(2, '0')}`;
const taken = () => new Set(D.picks.map(p => p.p));
const info = e => { const p = M.players[e.id] || {}, bye = byes[e.team]; return [p.age ? `${p.age} yrs` : null, bye ? `Bye ${bye}` : null].filter(Boolean).join(' · '); };
const byLabel = b => ({ auto: ' · auto', sim: ' · computer', queue: ' · from queue', commish: ' · by commissioner' }[b] || '');

// A second, deliberate step for anything that changes the league rosters: a box that says exactly what will happen.
function confirmBox(title, body, yes, danger) {
  return new Promise(res => {
    const d = document.createElement('dialog'); d.className = 'dr-confirm';
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><p>${body}</p><div class="dr-cbtns"><button class="btn" value="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" value="yes">${esc(yes)}</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => { res(d.returnValue === 'yes'); d.remove(); });
    d.showModal(); d.querySelector('[value="no"]').focus();
  });
}
const OFFICIAL_MSG = 'This will make all league rosters official with this draft\'s picks. Every team page, player card and lineup will use them, replacing the current rosters and any earlier official draft.';

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
  const open = list.filter(d => d.status !== 'done'), done = list.filter(d => d.status === 'done');
  const status = d => (d.status === 'setup' ? 'Not started yet' : d.status === 'paused' ? `Paused at pick ${d.picks.length + 1}` : `Live now · pick ${d.picks.length + 1} of ${d.rounds * d.teams.length}`);
  const card = d => `<a class="dr-join ${esc(d.status)}" href="draftroom.html?d=${d.id}"><div><span class="eyebrow">${d.kind === 'rookie' ? 'Rookie' : 'Startup'} draft · ${d.practice ? 'mock' : 'official'}</span><b>${esc(d.name)}</b>
      <span class="pmeta">${esc(status(d))}${myTeam != null && d.teams.includes(myTeam) ? ` · your seat: ${esc(tName(myTeam))}` : ''}</span></div><span class="btn primary">Enter draft room</span></a>`;
  const row = d => `<a class="dr-lrow" href="draftroom.html?d=${d.id}"><b>${esc(d.name)}</b><span>${d.kind === 'rookie' ? 'Rookie' : 'Startup'} · ${d.rounds} rounds · ${d.teams.length} teams · ${esc(new Date(d.updated || d.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span>
    <span class="dr-st ${d.official ? 'official' : 'done'}">${d.official ? 'Official · league rosters' : d.practice ? 'Mock' : 'Complete'}</span></a>`;
  content().innerHTML = `<div class="grid">
    <section class="panel s12"><header><div><span class="eyebrow">The Blitz League's own draft room</span><h2>Drafts happening now</h2></div></header>
      ${open.length ? `<div class="dr-joins">${open.map(card).join('')}</div>` : '<div class="empty">No draft is running right now.</div>'}
      ${!commish && myTeam == null ? '<p class="footnote">Your account isn\'t linked to a team yet, so you can watch but not pick. The commissioner links it on the Account page.</p>' : ''}</section>
    ${done.length ? `<section class="panel s12"><header><div><h2>Completed drafts</h2></div></header><div class="dr-lobby">${done.map(row).join('')}</div>
      <p class="footnote">The draft marked official is the one the league rosters come from. Open any draft to see its full board.</p></section>` : ''}
    ${commish ? `<section class="panel s12"><header><div><span class="eyebrow">Commissioner</span><h2>New practice draft</h2></div></header>
      <details class="dr-newbox"${list.length ? '' : ' open'}><summary class="btn">Set up a new draft</summary>
      <form id="dr-new" class="dr-form">
        <label>Name <input name="name" maxlength="60" placeholder="Startup practice draft"></label>
        <label>Type <select name="kind"><option value="startup">Startup (24 rounds, all NFL players)</option><option value="rookie">Rookie (4 rounds, rookies only)</option></select></label>
        <label>Rounds <input name="rounds" type="number" min="1" max="30" value="24"></label>
        <label>Pick clock (seconds) <input name="clockSec" type="number" min="10" max="86400" value="120"></label>
        <label>Computer picks after (seconds) <input name="simDelay" type="number" min="1" max="60" value="2"></label>
        <label class="dr-check"><input name="shuffle" type="checkbox" checked> Random draft order (you can reorder before it starts)</label>
        <div class="dr-mode"><button class="btn" type="submit" value="mock">Create mock draft</button><button class="btn primary" type="submit" value="official">Create official draft</button></div>
      </form>
      <p class="footnote"><b>Mock:</b> for practice; never changes the rosters, and the computer drafts empty seats after a few seconds. <b>Official:</b> when the last pick is made, the picks become the league rosters; empty seats get the full pick clock. GMs linked to a team sit at it automatically when they open the room. Only you can start a draft.</p></details></section>` : ''}</div>`;
  const f = $('dr-new');
  if (f) {
    // A rookie draft uses the order the season tools saved (rule 8-2-3) and that year's picks, so traded picks go to their owners.
    const SC = (M && M.league && M.league.seasonConfig) || {};
    f.kind.addEventListener('change', () => { const rk = f.kind.value === 'rookie'; f.rounds.value = rk ? 4 : 24; if (rk && (SC.draftOrder || []).length) f.shuffle.checked = false; });
    f.addEventListener('submit', async e => {
      e.preventDefault(); const b = e.submitter || f.querySelector('[value="mock"]'), official = b.value === 'official', label = b.textContent;
      if (official && !await confirmBox('Create an official draft?', OFFICIAL_MSG.replace("this draft's picks", "this draft's picks as soon as the last pick is made"), 'Yes, create official draft')) return;
      b.disabled = true; b.textContent = 'Creating…';
      const rk = f.kind.value === 'rookie', saved = (SC.draftOrder || []).filter(t => teams.some(x => x.id === t));
      let order = rk && saved.length === teams.length ? saved : teams.map(t => t.id);
      if (f.shuffle.checked) order = order.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
      try { const r = await act({ action: 'create', name: f.name.value, kind: f.kind.value, rounds: f.rounds.value, clockSec: f.clockSec.value, simDelay: f.simDelay.value, teams: order, official, pickSeason: rk ? SC.draftSeason || null : null });
        location.href = `draftroom.html?d=${r.id}`; } catch (err) { b.disabled = false; b.textContent = label; }
    });
  }
}

// ---------- the room: each part as HTML ----------
function headerHTML() {
  const t = onClock(), seat = mySeat(), mine = seat && String(t) === seat;
  const round = Math.floor(D.picks.length / D.teams.length) + 1, inRound = D.picks.length % D.teams.length + 1;
  const status = D.status === 'done' ? 'Draft complete' : D.status === 'setup' ? 'Waiting for the commissioner to start' : D.status === 'paused' ? 'Paused' : `Round ${round} · pick ${inRound} · overall ${D.picks.length + 1}`;
  const running = D.status === 'live' || D.status === 'paused';
  const next = running && D.picks.length + 1 < D.rounds * D.teams.length ? ownerAt(D.picks.length + 1) : null;
  return `<div class="dr-top${mine && D.status === 'live' ? ' mine' : ''}">
    <div class="dr-now">${running ? `${tMark(t)}<div><span class="eyebrow">${mine ? 'You are on the clock' : 'On the clock'}</span><b>${esc(tName(t))}</b>${next != null ? `<small class="pmeta">Next: ${esc(tName(next))}</small>` : ''}</div>` : `<div><span class="eyebrow">${esc(D.kind === 'rookie' ? 'Rookie draft' : 'Startup draft')} · ${D.practice ? 'mock' : 'official'}</span><b>${esc(D.name)}</b></div>`}</div>
    <div class="dr-clock"><span id="dr-clock">${D.status === 'live' ? mmss(left()) : D.status === 'paused' ? mmss(D.pausedLeft || 0) : '--:--'}</span><small>${esc(status)}</small></div>
    <div class="dr-me">${seat ? `<span class="eyebrow">Your team</span><b>${tMark(seat)} ${esc(tName(seat))}</b>` : `<span class="eyebrow">Watching</span><b>${myTeam == null && !commish ? 'Not linked to a team' : 'No seat'}</b>`}</div>
  </div>`;
}

function commishHTML() {
  if (!commish) return '';
  const seat = mySeat();
  return `<div class="dr-commish"><span class="eyebrow">Commissioner</span>
    ${D.status === 'setup' ? '<button class="btn primary" data-a="start">Start draft</button>' : ''}
    ${D.status === 'live' ? '<button class="btn" data-a="pause">Pause</button>' : ''}${D.status === 'paused' ? '<button class="btn primary" data-a="resume">Resume</button>' : ''}
    ${D.picks.length && !D.official ? '<button class="btn" data-a="undo">Undo last pick</button>' : ''}
    ${D.status === 'done' ? `<button class="btn${D.official ? '' : ' primary'}" data-a="official">${D.official ? 'Unmark official' : 'Mark as official'}</button>` : ''}
    <button class="btn danger" data-a="delete">Delete draft</button>
    <label>Your seat <select id="dr-seat"><option value="">Watch only</option>${D.teams.map(t => `<option value="${t}"${String(t) === seat ? ' selected' : ''}>${esc(tName(t))}${D.seats[t] && D.seats[t] !== me.uid ? ' (a GM is here)' : ''}</option>`).join('')}</select></label>
    ${D.status === 'setup' ? `<label>Clock <input id="dr-clocks" type="number" min="10" value="${D.clockSec}"> s</label><button class="btn" data-a="shuffle">Shuffle order</button>` : `<span class="pmeta">Clock ${D.clockSec}s · computer ${D.simDelay}s</span>`}
    <span class="pmeta">GMs in the room: ${Object.keys(D.seats).length ? Object.keys(D.seats).map(t => esc(tName(t))).join(', ') : 'none yet'}</span>
  </div>`;
}

function resultHTML() {
  if (D.status !== 'done') return D.practice ? '' : `<div class="dr-result ok"><b>Official draft.</b> When the last pick is made, these picks become the league rosters.</div>`;
  return D.official
    ? '<div class="dr-result ok"><b>Official.</b> These picks are now the league rosters: every team page, player card and the Network show them. <a href="teams.html">See the teams</a></div>'
    : `<div class="dr-result"><b>${D.practice ? 'Mock draft complete.' : 'Draft complete.'}</b> ${commish ? 'Mark it as official to make these picks the league rosters (this replaces the current rosters).' : 'The commissioner can make these picks the league rosters by marking the draft official.'}</div>`;
}

function boardHTML() {
  const T = D.teams.length, cur = D.status === 'done' ? -1 : D.picks.length, seat = mySeat();
  let rows = '';
  for (let r = 0; r < D.rounds; r++) {
    rows += `<tr><th>${r + 1}</th>${D.teams.map((t, c) => {
      const n = r * T + c, p = D.picks[n], e = p && byId[p.p], mine = String(t) === seat ? ' mine' : '';
      if (p) return `<td class="dr-cell p-${esc(e ? e.pos : '')}${mine}" data-pid="${esc(p.p)}" title="${esc(e ? `${slot(n)} ${e.name}, ${e.pos} ${e.team}` : '')}"><b>${esc(e ? short(e.name) : p.p)}</b><small>${esc(e ? `${e.pos} ${e.team}` : '')}</small></td>`;
      return `<td class="dr-cell${n === cur ? ' now' : ''}${mine}"><small>${slot(n)}</small></td>`;
    }).join('')}</tr>`;
  }
  return `<table class="dr-board"><thead><tr><th></th>${D.teams.map(t => `<th${String(t) === seat ? ' class="me"' : ''}>${tMark(t)}<span>${esc(M.teams[t] ? M.teams[t].f.abbr || tName(t) : t)}</span></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

function canPick() { const seat = mySeat(), t = onClock(); return D.status === 'live' && (commish || (!!seat && String(t) === seat)); }

function listHTML() {
  const tk = taken(), q = view.q.trim().toLowerCase(), seat = mySeat(), can = canPick(), inQ = new Set(Q.list);
  const list = pool.filter(e => !tk.has(e.id) && (view.pos === 'all' || e.pos === view.pos) && (!q || e.name.toLowerCase().includes(q) || e.team.toLowerCase() === q));
  return list.slice(0, view.limit).map(e => `<div class="dr-pl" data-row="${esc(e.id)}"><span class="rk">${e.rank + 1}</span><span class="nw-who" data-pid="${esc(e.id)}">${shot(e.id, 'nw-shot')}<span><b>${esc(e.name)}</b><small><span class="pos ${esc(e.pos)}">${esc(e.pos)}</span> ${esc(e.team)}${info(e) ? ` · ${esc(info(e))}` : ''}</small></span></span>
      <span class="dr-ppg">${e.ppg ? e.ppg.toFixed(1) : '-'}<small>pts/g</small></span>
      ${seat ? `<button class="btn dr-q${inQ.has(e.id) ? ' on' : ''}" data-queue="${esc(e.id)}" title="${inQ.has(e.id) ? 'Remove from queue' : 'Add to queue'}">${inQ.has(e.id) ? '✓ Q' : '+ Q'}</button>` : ''}
      ${can ? `<button class="btn primary" data-draft="${esc(e.id)}">Draft</button>` : ''}</div>`).join('')
    + (list.length > view.limit ? `<button class="btn dr-more" data-more="1">Show more (${list.length - view.limit} more)</button>` : '')
    || '<div class="empty">No players match.</div>';
}

function queueHTML() {
  const seat = mySeat();
  if (!seat) return `<div class="empty">${myTeam == null && !commish ? "Your account isn't linked to a team yet, so you can't keep a queue. The commissioner links it on the Account page." : 'Sit at a team to keep a queue.'}</div>`;
  const tk = taken(), list = Q.list.filter(id => !tk.has(id));
  return `<label class="dr-check dr-auto"><input type="checkbox" id="dr-auto"${Q.auto ? ' checked' : ''}> Draft from my queue automatically</label>
    ${list.length ? `<ol class="dr-queue">${list.map((id, i) => { const e = byId[id] || { name: id, pos: '', team: '' };
    return `<li><span class="nw-who" data-pid="${esc(id)}"><span><b>${esc(e.name)}</b><small><span class="pos ${esc(e.pos)}">${esc(e.pos)}</span> ${esc(e.team)}${e.id && info(e) ? ` · ${esc(info(e))}` : ''}</small></span></span>
      <span class="dr-qbtn">${i ? `<button class="btn" data-qup="${esc(id)}" aria-label="Move up">▲</button>` : ''}<button class="btn" data-queue="${esc(id)}" aria-label="Remove">✕</button></span></li>`; }).join('')}</ol>`
    : '<div class="empty">Your queue is empty. Add players with "+ Q".</div>'}
    <p class="footnote">${Q.auto ? 'On: the moment you are on the clock, the first player in your queue who is still available is drafted for you. Turn it off to make every pick yourself.' : 'Off: you make your own picks. Your queue is still used if your clock runs out.'} With an empty queue, a timed-out pick is the best player available.</p>`;
}

function rosterHTML() {
  const t = view.team || mySeat() || onClock() || D.teams[0];
  const picks = D.picks.map((p, n) => ({ ...p, n })).filter(p => String(p.t) === String(t));
  const by = {}; for (const p of picks) { const e = byId[p.p], k = e ? e.pos : 'Other'; (by[k] = by[k] || []).push({ p, e }); }
  return `<label class="dr-rsel">Team <select id="dr-team">${D.teams.map(x => `<option value="${x}"${String(x) === String(t) ? ' selected' : ''}>${esc(tName(x))}</option>`).join('')}</select></label>
    <div class="dr-roster">${POS.map(pos => `<div><div class="sub"><span class="pos ${pos}">${pos}</span> ${(by[pos] || []).length}${NEED[pos] && (by[pos] || []).length < NEED[pos] ? ` <small class="dr-need">need ${NEED[pos] - (by[pos] || []).length}</small>` : ''}</div>
      ${(by[pos] || []).map(({ p, e }) => `<div class="dr-rp" data-pid="${esc(p.p)}"><b>${esc(e ? e.name : p.p)}</b><small>${esc(e ? `${e.team}${info(e) ? ' · ' + info(e) : ''}` : '')} · ${slot(p.n)}</small></div>`).join('')}</div>`).join('')}</div>
    <p class="footnote">${picks.length} of ${D.rounds} picks. Starting lineup needs 1 QB, 2 RB, 2 WR, 1 TE, 1 K, 1 DL, 1 LB, 1 DB plus flex spots (rule 7-2-1). Most 2 QBs (8-1-4).</p>`;
}

function recentHTML() {
  return D.picks.slice(-12).reverse().map((p, i) => { const n = D.picks.length - 1 - i, e = byId[p.p];
    return `<div class="dr-rec"><span class="rk">${slot(n)}</span>${tMark(p.t)}<span data-pid="${esc(p.p)}"><b>${esc(e ? e.name : p.p)}</b><small>${esc(e ? `${e.pos} · ${e.team}` : '')} · ${esc(tName(p.t))}${byLabel(p.by)}</small></span></div>`; }).join('') || '<div class="empty">No picks yet.</div>';
}

// ---------- drawing without jumping ----------
// The room's frame is built once; afterwards each part is replaced only when its HTML changed. Scroll positions are
// kept, and in the player list the row at the top of the view stays put even when players above it get drafted.
const TABS = [['players', 'Players'], ['queue', 'Queue'], ['roster', 'Rosters'], ['board', 'Board'], ['recent', 'Picks']];
function frame() {
  const tb = list => list.map(([k, l]) => `<button data-tab="${k}" aria-selected="${view.tab === k}">${l}<span data-count="${k}"></span></button>`).join('');
  content().innerHTML = `<div class="dr">
    <div id="dr-head" class="dr-headwrap"></div><div id="dr-cm"></div><div id="dr-res"></div>
    <div class="dr-tabs" role="tablist">${tb(TABS)}</div>
    <div class="dr-grid t-${view.tab}" id="dr-grid">
      <section class="panel dr-main"><header><div><h2>Board</h2></div><a class="aside" href="draftroom.html">All drafts</a></header><div class="dr-boardwrap" id="dr-board"></div></section>
      <aside class="dr-side">
        <div class="dr-stabs" role="tablist">${tb(TABS.filter(t => t[0] !== 'board'))}</div>
        <section class="panel dr-pane dr-avail" data-pane="players"><div class="dr-tools"><input id="dr-q" type="search" placeholder="Search players or NFL team" autocomplete="off">
          <div class="nw-filter" id="dr-pos"></div></div><div class="dr-list" id="dr-list"></div>
          <p class="footnote">Ranked by points per game this season in Blitz League scoring (fewer than 3 games counts for less). Tap a name for the player card.</p></section>
        <section class="panel dr-pane dr-qp" data-pane="queue"><div id="dr-queue"></div></section>
        <section class="panel dr-pane dr-rost" data-pane="roster"><div id="dr-roster"></div></section>
        <section class="panel dr-pane dr-recent" data-pane="recent"><div id="dr-recent"></div></section>
      </aside>
    </div></div>`;
  frame.built = true;
}

// Replace one part's HTML if it changed. Its own scroll (or the page's) stays where it was; with keepRow, the first row
// in view is held in place on screen.
function paint(id, html, keepRow) {
  const el = $(id); if (!el || el._html === html) return;
  const sc = el.closest('.dr-boardwrap, .dr-pane') || el, top = sc.scrollTop, lft = sc.scrollLeft;
  const inner = sc.scrollHeight > sc.clientHeight + 2;            // does this part scroll by itself, or with the page?
  let anchor = null;
  if (keepRow) {
    const edge = inner ? sc.getBoundingClientRect().top : (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--drh')) || 0) + 60;
    for (const r of el.querySelectorAll('[data-row]')) { const b = r.getBoundingClientRect(); if (b.bottom > edge) { anchor = { id: r.dataset.row, y: b.top, next: r.nextElementSibling && r.nextElementSibling.dataset.row }; break; } }
  }
  el.innerHTML = html; el._html = html;
  sc.scrollTop = top; sc.scrollLeft = lft;
  if (anchor) {
    const r = el.querySelector(`[data-row="${CSS.escape(anchor.id)}"]`) || (anchor.next && el.querySelector(`[data-row="${CSS.escape(anchor.next)}"]`));
    if (r) { const d = r.getBoundingClientRect().top - anchor.y; if (Math.abs(d) > 1) { if (inner) sc.scrollTop += d; else window.scrollBy(0, d); } }
  }
  paintHelmets(el).catch(() => {});
}

function render() {
  if (!D || !pool.length) return;
  if (!frame.built) frame();
  const y = window.scrollY;
  paint('dr-head', headerHTML()); paint('dr-cm', commishHTML()); paint('dr-res', resultHTML());
  paint('dr-board', boardHTML());
  paint('dr-pos', ['all', ...POS].map(p => `<button data-dpos="${p}" aria-pressed="${view.pos === p}">${p === 'all' ? 'All' : p}</button>`).join(''));
  const q = $('dr-q'); if (q.value !== view.q && document.activeElement !== q) q.value = view.q;
  paint('dr-queue', queueHTML()); paint('dr-roster', rosterHTML()); paint('dr-recent', recentHTML());
  const tk = taken(), qn = Q.list.filter(id => !tk.has(id)).length;
  document.querySelectorAll('[data-count="queue"]').forEach(s => { s.textContent = mySeat() && qn ? ` (${qn})` : ''; });
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === view.tab)));
  $('dr-grid').className = `dr-grid t-${view.tab}`;
  const h = document.querySelector('.dr-top'); if (h) document.documentElement.style.setProperty('--drh', h.offsetHeight + 'px');
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  paint('dr-list', listHTML(), true);
}

function clockLoop() {
  setInterval(() => {
    if (!D || D.status !== 'live') return;
    const ms = left(), el = $('dr-clock'); if (el) { el.textContent = mmss(ms); el.classList.toggle('low', ms < 10000); }
    // Time's up: ask the server for the automatic pick (once per pick from this page; the server double-checks the time).
    if (ms <= 0 && ticking !== D.picks.length) { ticking = D.picks.length; act({ action: 'tick' }, true).catch(() => { setTimeout(() => { ticking = -1; }, 3000); }); }
  }, 250);
}

// The player card, inside the draft room: whether he's still available (with queue and draft buttons), or who took
// him and when.
function cardContext(id) {
  if (!D) return null;
  const n = D.picks.findIndex(p => p.p === id), e = byId[id];
  if (n >= 0) return `<span class="pmeta">Drafted ${slot(n)} by <b>${esc(tName(D.picks[n].t))}</b> in this draft</span>`;
  if (!e) return '<span class="pmeta">Not in this draft\'s player pool</span>';
  const seat = mySeat(), inQ = Q.list.includes(id);
  return `<span class="pmeta">Available in this draft · rank ${e.rank + 1}</span>
    <span class="dr-cardbtns">${seat ? `<button class="btn dr-q${inQ ? ' on' : ''}" data-queue="${esc(id)}" data-close="1">${inQ ? '✓ In queue' : '+ Queue'}</button>` : ''}${canPick() ? `<button class="btn primary" data-draft="${esc(id)}" data-close="1">Draft</button>` : ''}</span>`;
}

function openDraft() {
  PlayerCard.context = cardContext;
  Promise.all([getDoc(doc(db, 'drafts', draftId, 'pool', 'all')), NFL.fillPlayers(M), NFL.byeWeeks().then(b => { byes = b; })]).then(([s]) => {
    pool = (s.data() || { list: [] }).list.map((x, rank) => { const [id, pos, name, team, ppg] = x.split('|'); return { id, pos, name, team, ppg: +ppg, rank }; });
    byId = Object.fromEntries(pool.map(e => [e.id, e])); render();
  });
  onSnapshot(doc(db, 'drafts', draftId), s => {
    if (!s.exists()) { frame.built = false; content().innerHTML = '<div class="empty">This draft was deleted. <a href="draftroom.html">All drafts</a></div>'; return; }
    D = s.data();
    // Sit at the team linked to this account, once, as soon as the draft opens (the server checks the link).
    if (!joined && myTeam != null && D.status !== 'done' && D.teams.map(String).includes(String(myTeam)) && !Object.values(D.seats).includes(me.uid)) {
      joined = true; act({ action: 'join' }, true).catch(() => {});
    }
    const seat = mySeat();
    if (qUnsub && qUnsub.team !== seat) { qUnsub(); qUnsub = null; Q = { list: [], auto: true }; }
    if (seat && !qUnsub) { qUnsub = onSnapshot(doc(db, 'drafts', draftId, 'queues', seat), q => { const v = q.data() || {}; Q = { list: v.list || [], auto: v.auto !== false }; render(); }, () => {}); qUnsub.team = seat; }
    render();
  }, e => { content().innerHTML = `<div class="error">Couldn't open this draft (${esc(e.message)}).</div>`; });
}

function saveQueue(list, auto) {
  Q = { list, auto: auto === undefined ? Q.auto : auto }; render();
  act({ action: 'queue', team: mySeat(), list: Q.list, auto: Q.auto }).catch(() => {});
}

function wire() {
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-a], [data-draft], [data-queue], [data-qup], [data-dpos], [data-tab], [data-more]'); if (!b) return;
    if (b.dataset.close) { const d = b.closest('dialog'); if (d) d.close(); }
    if (b.dataset.tab) { view.tab = b.dataset.tab; render(); return; }
    if (b.dataset.more) { view.limit += 200; render(); return; }
    if (b.dataset.dpos) { view.pos = b.dataset.dpos; const p = document.querySelector('.dr-avail'); if (p) p.scrollTop = 0; render(); return; }
    if (b.dataset.draft) { const e2 = byId[b.dataset.draft]; b.disabled = true; try { await act({ action: 'pick', n: D.picks.length, player: b.dataset.draft }); toast(`Drafted ${e2 ? e2.name : ''}`); } catch (err) { b.disabled = false; } return; }
    if (b.dataset.queue || b.dataset.qup) {
      const id = b.dataset.queue || b.dataset.qup, tk = taken(); let list = Q.list.filter(x => !tk.has(x));
      if (b.dataset.qup) { const i = list.indexOf(id); if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]]; }
      else list = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
      saveQueue(list); return;
    }
    const a = b.dataset.a;
    if (a === 'delete' && !confirm('Delete this draft for everyone? This cannot be undone.')) return;
    if (a === 'undo' && !confirm('Undo the last pick?')) return;
    if (a === 'official' && !await (D.official
      ? confirmBox('Unmark this draft?', 'The league rosters will no longer come from this draft; the site goes back to the placeholder rosters.', 'Yes, unmark it', true)
      : confirmBox('Make this draft official?', OFFICIAL_MSG, 'Yes, make rosters official'))) return;
    if (a === 'shuffle') { const t = D.teams.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(x => x[1]); await act({ action: 'setup', teams: t }).catch(() => {}); return; }
    b.disabled = true;
    try {
      const was = D.official;
      await act({ action: a, on: a === 'official' ? !was : undefined });
      if (a === 'delete') location.href = 'draftroom.html';
      if (a === 'official') toast(!was ? 'Official. The league rosters now come from this draft.' : 'No longer official.');
    } catch (err) { /* toast shown */ } finally { b.disabled = false; }
  });
  document.addEventListener('input', e => { if (e.target.id === 'dr-q') { view.q = e.target.value; const p = document.querySelector('.dr-avail'); if (p) p.scrollTop = 0; render(); } });
  document.addEventListener('change', e => {
    if (e.target.id === 'dr-team') { view.team = e.target.value; render(); }
    if (e.target.id === 'dr-auto') saveQueue(Q.list, e.target.checked);
    if (e.target.id === 'dr-seat') {
      const t = e.target.value || mySeat();
      if (t) act(e.target.value ? { action: 'seat', team: t } : { action: 'seat', team: t, uid: null }).catch(() => {});
    }
    if (e.target.id === 'dr-clocks') act({ action: 'setup', clockSec: e.target.value }).catch(() => {});
  });
  window.addEventListener('resize', () => { const h = document.querySelector('.dr-top'); if (h) document.documentElement.style.setProperty('--drh', h.offsetHeight + 'px'); });
}

UI.boot('<a href="draft.html">Draft</a> · <strong>Draft room</strong>', async model => {
  M = model;
  content().innerHTML = '<div class="loading">Signing in…</div>';
  onAuthStateChanged(auth, async user => {
    me = user;
    if (!user) { content().innerHTML = `<section class="panel"><div class="empty">The draft room is for League members. <a href="account.html">Sign in</a> first.</div></section>`; return; }
    const [roles, prof] = await Promise.all([getDoc(doc(db, 'config', 'roles')).catch(() => null), getDoc(doc(db, 'users', user.uid)).catch(() => null)]);
    commish = (((roles && roles.data()) || {}).commish || []).includes(user.uid);
    const t = ((prof && prof.data()) || {}).team; myTeam = t == null ? null : +t;
    if (draftId) { openDraft(); return; }
    onSnapshot(query(collection(db, 'drafts'), orderBy('created', 'desc'), limit(30)), s => lobby(s.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => { content().innerHTML = `<div class="error">Couldn't load drafts (${esc(e.message)}).</div>`; });
  });
  // This device's clock may be off; the countdown uses the web server's time (the Date header) instead.
  fetch(location.href, { method: 'HEAD', cache: 'no-store' }).then(r => { const t = Date.parse(r.headers.get('date')); if (t) skew = t + 500 - Date.now(); }).catch(() => {});
  wire(); clockLoop();
});
