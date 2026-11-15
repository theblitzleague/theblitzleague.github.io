/* League log, for the commissioner (Account page). Everything the server records in log/{id} (functions/index.js,
   logEvent): the Wednesday batch, every trade step, waiver results, commissioner actions, and anything that failed.
   Problems (warnings and errors) are flagged; entries newer than your last visit on this device are marked New. */
import { collection, query, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { db } from './fb.js';

const { esc } = UI;
const SEEN = 'blitz-log-seen';
const KIND = { batch: 'Batch', trade: 'Trade', waiver: 'Waiver', free_agent: 'Free agent', claim: 'Claim', commissioner: 'Commissioner', system: 'System' };

export function leagueLog(box) {
  let rows = [], seen = 0, filter = 'all';
  try { seen = +localStorage.getItem(SEEN) || 0; } catch (e) {}
  const when = ms => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  box.innerHTML = `<section class="panel s12"><header><div><span class="eyebrow">Commissioner</span><h2>League log</h2></div><span class="aside" id="lg-n"></span></header>
    <p class="acct-note">Everything important, newest first: the Wednesday batch, trades, waiver results, commissioner actions, and anything that failed.
      Problems are marked in red. You also get a notification when something fails.</p>
    <div class="acct-row" role="radiogroup" aria-label="Show">
      <label><input type="radio" name="lg-f" value="all" checked> Everything</label>
      <label><input type="radio" name="lg-f" value="bad"> Problems only</label>
      <button class="btn small" id="lg-read">Mark all read</button></div>
    <div id="lg-list" class="acct-list"><p class="pmeta">Loading…</p></div></section>`;
  const $ = id => box.querySelector('#' + id);
  const render = () => {
    const bad = r => r.level === 'error' || r.level === 'warn';
    const shown = rows.filter(r => filter === 'all' || bad(r)).slice(0, 100);
    const fresh = rows.filter(r => r.at > seen).length, problems = rows.filter(r => r.at > seen && r.level === 'error').length;
    $('lg-n').textContent = problems ? `${problems} new problem${problems === 1 ? '' : 's'}` : fresh ? `${fresh} new` : '';
    $('lg-n').className = 'aside' + (problems ? ' bad' : '');
    $('lg-list').innerHTML = shown.map(r => `<div class="acct-item lg-${esc(r.level)}"><div>
        <span class="pmeta">${r.at > seen ? '<span class="tag ok">New</span> ' : ''}<span class="tag ${r.level === 'error' ? 'out' : r.level === 'warn' ? 'q' : 'taxi'}">${esc(r.level === 'error' ? 'Problem' : r.level === 'warn' ? 'Heads up' : KIND[r.kind] || r.kind)}</span> ${when(r.at)}</span>
        <b>${esc(r.title)}</b>${r.body ? `<p>${esc(r.body)}</p>` : ''}</div></div>`).join('')
      || `<p class="empty">${filter === 'all' ? 'Nothing logged yet. Entries start appearing with the next trade, waiver move or batch.' : 'No problems. 👍'}</p>`;
  };
  for (const r of box.querySelectorAll('input[name="lg-f"]')) r.onchange = () => { filter = r.value; render(); };
  $('lg-read').onclick = () => { seen = Date.now(); try { localStorage.setItem(SEEN, String(seen)); } catch (e) {} render(); };
  onSnapshot(query(collection(db, 'log'), orderBy('at', 'desc'), limit(300)), s => { rows = s.docs.map(d => d.data()); render(); },
    e => { $('lg-list').innerHTML = `<p class="bad">Couldn't load the log (${esc(e.message)}).</p>`; });
}
