/* Rules page (rules.html): the League's official rules, built from the Commissioner's rulebook by tools/build_rules.py
   into data/rules.html. Shows the seal, a contents list that jumps to each rule, and the printable rule book (PDF). */
(function () {
  const { esc } = UI;
  const PDF = 'assets/rules/blitz-league-official-rules.pdf';

  UI.boot('<strong>Rules</strong>', async () => {
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
          <img class="rb-seal" src="assets/league/blitz-shield.webp" alt="The Blitz League seal" width="160" height="200">
          <div><span class="eyebrow">Issued by the Commissioner's Office</span>
            <h1>${esc(meta.title || 'Official Rules of The Blitz League')}</h1>
            ${meta.adopted ? `<p class="pmeta">Adopted ${esc(meta.adopted)}. In effect from publication on the League Website (13-2-1).</p>` : ''}
            <div class="acct-row"><a class="btn primary" href="${PDF}" download>Download the rule book (PDF)</a></div></div>
        </header>
        <nav class="rb-toc" aria-label="Contents"><div class="sub">Contents</div>
          <ol>${(meta.toc || []).map(([id, t]) => `<li><a href="#${esc(id)}">${esc(t)}</a></li>`).join('')}</ol></nav>
        <article class="rb-body">${box.innerHTML}</article>
      </section>`;
    if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) requestAnimationFrame(() => el.scrollIntoView()); }
  });
})();
