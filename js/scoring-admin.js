/* League scoring editor for the commissioner (Account page). Changes go through the "settings" function
   (functions/index.js), which checks again: commissioner only; a change starts at a week no game has kicked off yet;
   midseason needs a unanimous vote of all 12 Owners, next season a Supermajority. Every game is scored with the version
   in effect that week, so a change never rewrites a game already played. */
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js';
import { app } from './fb.js';

const { esc } = UI;
const call = httpsCallable(getFunctions(app, 'us-central1'), 'settings');

import { GROUPS, label, groupOf } from './scoring-names.js';

export function scoringAdmin(M, box) {
  const season = +M.state.season, cur = +M.current, first = M.weekStarted ? cur + 1 : cur;
  const base = M.scoringBase || {}, keys = Object.keys(base);
  const starts = [...Array.from({ length: Math.max(0, 18 - first + 1) }, (_, i) => [season, first + i]), [season + 1, 1]];
  let all = false;
  const draw = () => {
    const [s0, w0] = (box.querySelector('#sc-start') || { value: `${starts[0][0]}-${starts[0][1]}` }).value.split('-').map(Number);
    const now = M.scoringAt(s0, w0), mid = s0 === season && w0 > 1;
    const rows = GROUPS.map(([g], gi) => {
      const ks = keys.filter(k => groupOf(k) === gi && (all || ((now[k] || base[k]) && gi < GROUPS.length - 1))).sort((a, b) => label(a).localeCompare(label(b)));
      return ks.length ? `<div class="sub">${esc(g)}</div><div class="sc-grid">${ks.map(k => `<label class="sc-row"><span>${esc(label(k))}</span>
        <input type="number" step="any" inputmode="decimal" data-k="${esc(k)}" value="${now[k] || 0}"></label>`).join('')}</div>` : '';
    }).join('');
    const log = (M.scoringLog || []).slice().sort((a, b) => b.at - a.at);
    box.innerHTML = `<section class="panel s12"><header><div><span class="eyebrow">Commissioner</span><h2>League scoring</h2></div></header>
      <p class="acct-note">Change a point value, pick the week it starts, confirm the vote, then save. Every game is scored with the scoring in effect
        that week, so a change never touches a game that's already been played. The earliest start is the first week no game has kicked off.</p>
      <div class="acct-row"><label>Starts <select id="sc-start">${starts.map(([s, w]) => `<option value="${s}-${w}"${s === s0 && w === w0 ? ' selected' : ''}>${s === season ? `Week ${w}, ${s}` : `Next season (${s})`}</option>`).join('')}</select></label>
        <label><input type="checkbox" id="sc-all"${all ? ' checked' : ''}> Show every stat (including ones that score 0 and team defense)</label></div>
      ${rows}
      <div class="sc-vote">
        <label><input type="checkbox" id="sc-ok"> ${mid ? '<b>All 12 Owners voted yes.</b> A midseason scoring change needs a unanimous vote.' : '<b>Passed by Supermajority vote</b> of the Owners (rule 13-1-2).'}</label>
        <input id="sc-vote" maxlength="200" placeholder="Vote record, e.g. 12-0 by text on Nov 12">
        <input id="sc-note" maxlength="300" placeholder="Reason (optional, shown in the change log)">
      </div>
      <div class="acct-row"><button class="btn primary" id="sc-save">Save scoring change</button><span class="pmeta" id="sc-msg"></span></div>
      <div class="sub">Change log</div>
      <div class="acct-list">${log.length ? log.map(e => `<div class="acct-item"><div><b>Starts Week ${e.week}, ${e.season}</b>
        <p>${(e.changes || []).map(c => `${esc(label(c.k))}: ${c.from} → ${c.to}`).join(' · ')}</p>
        <span class="pmeta">Saved ${new Date(e.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · vote: ${esc(e.vote || '')}${e.note ? ' · ' + esc(e.note) : ''}</span></div></div>`).join('')
        : '<p class="empty">No changes yet. The League is on its original scoring.</p>'}</div></section>`;
    box.querySelector('#sc-start').onchange = draw;
    box.querySelector('#sc-all').onchange = e => { all = e.target.checked; draw(); };
    box.querySelector('#sc-save').onclick = async () => {
      const msg = box.querySelector('#sc-msg'), vote = box.querySelector('#sc-vote').value.trim();
      if (!box.querySelector('#sc-ok').checked || !vote) { msg.textContent = 'Confirm the vote and write down the vote record first.'; return; }
      const settings = { ...now };
      for (const i of box.querySelectorAll('[data-k]')) settings[i.dataset.k] = Number(i.value) || 0;
      const changed = keys.filter(k => (settings[k] || 0) !== (now[k] || 0));
      if (!changed.length) { msg.textContent = 'Nothing changed.'; return; }
      if (!confirm(`Change ${changed.length} scoring value${changed.length > 1 ? 's' : ''} starting ${s0 === season ? `Week ${w0}, ${s0}` : `next season (${s0})`}?\n\n${changed.map(k => `${label(k)}: ${now[k] || 0} → ${settings[k]}`).join('\n')}\n\nGames already played won't change.`)) return;
      const btn = box.querySelector('#sc-save'); btn.disabled = true; msg.textContent = 'Saving…';
      try { await call({ action: 'scoring', season: s0, week: w0, settings, vote, note: box.querySelector('#sc-note').value.trim() }); msg.textContent = 'Saved. Reloading…'; setTimeout(() => location.reload(), 900); }
      catch (e) { msg.textContent = e.message.replace(/^.*?: /, ''); btn.disabled = false; }
    };
  };
  draw();
}
