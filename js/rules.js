/* Rules page (rules.html): the League's official rules, built from the Commissioner's rulebook by tools/build_rules.py
   into data/rules.html. Shows the seal, a contents list that jumps to each rule, and the printable rule book (PDF). */
(function () {
  const { esc } = UI;
  const PDF = 'assets/rules/blitz-league-official-rules.pdf';

  UI.boot('<strong>Rules</strong>', async M => {
    const r = await fetch('data/rules.html', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`rules ${r.status}`);
    const frag = await r.text();
    const box = document.createElement('div');
    box.innerHTML = frag;
    const meta = JSON.parse((box.querySelector('#rb-meta') || {}).textContent || '{}');
    box.querySelector('#rb-meta')?.remove();
    document.getElementById('content').innerHTML = `
      <section class="panel rb">
        <header class="rb-head">
          <img class="rb-seal" src="assets/league/blitz-league.webp" alt="The Blitz League" width="874" height="900">
          <div><span class="eyebrow">Issued by the Commissioner's Office</span>
            <h1>${esc(meta.title || 'Official Rules of The Blitz League')}</h1>
            ${meta.adopted ? `<p class="pmeta">Adopted ${esc(meta.adopted)}. In effect from publication on the League Website (13-2-1).</p>` : ''}
            <div class="acct-row"><a class="btn primary" href="${PDF}" download>Download the rule book (PDF)</a></div></div>
        </header>
        <nav class="rb-toc" aria-label="Contents"><div class="sub">Contents</div>
          <ol>${(meta.toc || []).map(([id, t]) => `<li><a href="#${esc(id)}">${esc(t)}</a></li>`).join('')}</ol></nav>
        <article class="rb-body">${box.innerHTML}</article>
      </section>
      <section class="panel" id="scoring-changes"></section>`;
    // The dated record of scoring changes (13-2-3), saved by the commissioner on the Account page.
    const log = ((M && M.scoringLog) || []).slice().sort((a, b) => b.at - a.at), sc = document.getElementById('scoring-changes');
    if (!log.length) sc.remove();
    else import('./scoring-names.js').then(({ label }) => {
      sc.innerHTML = `<header><div><span class="eyebrow">Rule 13-2-3</span><h2>Scoring changes</h2></div></header>
        <p class="acct-note">Every change to the League's scoring, with the week it starts. Games before that week keep the scoring they were played under.</p>
        <div class="acct-list">${log.map(e => `<div class="acct-item"><div><b>Starts Week ${esc(e.week)}, ${esc(e.season)}</b>
          <p>${(e.changes || []).map(c => `${esc(label(c.k))}: ${esc(c.from)} → ${esc(c.to)}`).join(' · ')}</p>
          <span class="pmeta">Adopted ${esc(new Date(e.at).toLocaleDateString([], { dateStyle: 'long' }))} · vote: ${esc(e.vote || '')}${e.note ? ' · ' + esc(e.note) : ''}</span></div></div>`).join('')}</div>`;
    });
    if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) requestAnimationFrame(() => el.scrollIntoView()); }
  });
})();
