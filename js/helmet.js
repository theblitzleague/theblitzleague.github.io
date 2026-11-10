/* The Blitz League helmet: one realistic grayscale template (assets/helmet/side.webp, facing right),
   recolored in the browser per franchise. helmetHTML(f, { facing }) returns a placeholder;
   paintHelmets(root) fills it in. The away helmet is the same image mirrored; a decal (if the
   franchise has one) sits on top and is never mirrored, so lettering always reads correctly. */
(function () {
  const TEMPLATE = 'assets/helmet/side.webp';
  let tpl;
  const cache = {};
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Recolor the grayscale side-view helmet template (assets/helmet/side.webp) into team colors.
  // Parts are found by brightness plus where they sit on this specific template (fractions of width/height):
  //   facemask: dark pixels in the front half         stripe: mid-grey along the crown
  //   kept grey: chin straps, jaw pad, rear bumper     shell: everything else that's light (shading and gloss kept)
  // If the template image ever changes, these zones need re-mapping.
  function recolorHelmet(img, colors) {
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const S = hex(colors.shell), T = hex(colors.stripe), M = hex(colors.facemask);
    // Measured on this template: straps/bumper/jaw pad are brightness <= ~145, the shell around them >= ~160.
    const KEEP = [ // [x0, x1, y0, y1]
      [0.08, 0.31, 0.80, 0.93],  // rear bumper
      [0.29, 0.48, 0.80, 0.99],  // lower chin strap
      [0.40, 0.64, 0.48, 0.77],  // upper chin strap
      [0.66, 0.90, 0.76, 0.99],  // jaw pad
    ];
    const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const id = x.getImageData(0, 0, c.width, c.height), d = id.data, W = c.width, H = c.height;
    const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    const mix = (o, n, w) => o + (n - o) * w;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const L = (d[i] + d[i + 1] + d[i + 2]) / 3, px = ((i / 4) % W) / W, py = Math.floor(i / 4 / W) / H;
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (L < 95) {
        const w = sm(0.485, 0.51, px) * (1 - sm(80, 95, L));          // facemask (vents further back stay black)
        const k = 0.58 + L / 140;
        r = mix(r, M[0] * k, w); g = mix(g, M[1] * k, w); b = mix(b, M[2] * k, w);
      } else {
        const inKeep = KEEP.some(z => px >= z[0] && px <= z[1] && py >= z[2] && py <= z[3]);
        const keepW = inKeep ? 1 - sm(146, 160, L) : 0;
        const crown = (1 - sm(0.20, 0.30, py)) * sm(0.28, 0.38, px);
        const stripeW = crown * (1 - sm(186, 198, L));
        const hl = Math.pow(sm(236, 252, L), 1.4) * 0.8;               // gloss highlights stay bright
        const s = L / 222, t = L / 170;
        let sr = mix(S[0] * s, 255, hl), sg = mix(S[1] * s, 255, hl), sb = mix(S[2] * s, 255, hl);
        const tr = T[0] * t, tg = T[1] * t, tb = T[2] * t;
        const w = sm(95, 118, L) * (1 - keepW);                       // fade in above the darkest edges; straps stay grey
        r = mix(r, mix(sr, tr, stripeW), w); g = mix(g, mix(sg, tg, stripeW), w); b = mix(b, mix(sb, tb, stripeW), w);
      }
      d[i] = Math.min(255, r); d[i + 1] = Math.min(255, g); d[i + 2] = Math.min(255, b);
    }
    x.putImageData(id, 0, 0);
    return c.toDataURL('image/webp', 0.92);
  }

  function loadTemplate() {
    return tpl || (tpl = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('helmet template failed to load')); i.src = TEMPLATE; }));
  }

  // opts.facing: 'right' | 'left'. opts.variant: 'home' | 'away' (away uses f.helmetAway colors, if any).
  // A franchise with finished renders (f.helmetImages[variant][facing]) gets those instead of the recolor.
  window.helmetHTML = function (f, opts) {
    const facing = (opts && opts.facing) || 'right', variant = (opts && opts.variant) || 'home';
    const imgs = f.helmetImages || {}, photo = (imgs[variant] || (variant === 'away' && !f.helmetAway && imgs.home) || {})[facing];   // no away set: wear the home render
    if (photo) return `<span class="helmet photo" role="img" aria-label="${esc(f.location)} ${variant} helmet"><img class="shell" src="${esc(photo)}" alt=""></span>`;
    const h = (variant === 'away' && f.helmetAway) || f.helmet || {};
    const decal = f.logos && f.logos.helmetDecal;
    return `<span class="helmet${facing === 'left' ? ' away' : ''}" role="img" aria-label="${esc(f.location)} helmet"
      data-shell="${esc(h.shell || f.colors.primary)}" data-stripe="${esc(h.stripe || f.colors.secondary)}" data-mask="${esc(h.facemask || f.colors.trim)}">
      <img class="shell" alt="">${decal ? `<img class="decal" src="${esc(decal)}" alt="">` : ''}</span>`;
  };

  window.paintHelmets = async function (root) {
    const els = (root || document).querySelectorAll('.helmet[data-shell]:not([data-painted])');
    if (!els.length) return;
    const img = await loadTemplate();
    els.forEach(el => {
      const key = [el.dataset.shell, el.dataset.stripe, el.dataset.mask].join('|');
      cache[key] = cache[key] || recolorHelmet(img, { shell: el.dataset.shell, stripe: el.dataset.stripe, facemask: el.dataset.mask });
      el.querySelector('img.shell').src = cache[key];
      el.dataset.painted = '1';
    });
  };

  /* Placeholder team mark: a shield with the abbreviation, until real logos arrive. */
  window.markSVG = function (f, cls) {
    const m = f.logos && (f.logos.mark || (!f.logos.primaryWide && f.logos.primary));   // a wide crest is unreadable at mark size
    if (m) return `<img class="${cls || 'mark'} logo-img" src="${esc(m)}" alt="${esc(f.location)}${f.nickname ? ' ' + esc(f.nickname) : ''}">`;
    const len = String(f.abbr).length;
    return `<svg class="${cls || 'mark'}" viewBox="0 0 100 104" role="img" aria-label="${esc(f.location)}">
  <path d="M50 4 L92 18 V52 C92 78 72 94 50 100 C28 94 8 78 8 52 V18 Z" fill="${esc(f.colors.primary)}" stroke="${esc(f.colors.secondary)}" stroke-width="5"/>
  <path d="M50 14 L82 25 V52 C82 72 67 85 50 90 C33 85 18 72 18 52 V25 Z" fill="none" stroke="${esc(f.colors.trim)}" stroke-opacity=".35" stroke-width="1.5"/>
  <text x="50" y="${len > 2 ? 64 : 67}" text-anchor="middle" font-family="'Barlow Condensed', 'Arial Narrow', sans-serif" font-weight="800" font-size="${len > 2 ? 30 : 38}" fill="${esc(f.colors.trim)}">${esc(f.abbr)}</text>
</svg>`;
  };
  /* Division mark. Dark-ink marks get tinted through a CSS mask (markOnDark) so they read on the dark site.
     The mask URL is made absolute: url() inside a custom property resolves against the stylesheet, not the page. */
  window.divMarkHTML = function (d, cls) {
    if (!d || !d.mark) return '';
    if (d.markOnDark) return `<span class="${cls || 'divmark'} divmask" role="img" aria-label="${esc(d.name)}" style="--src:url('${esc(new URL(d.mark, document.baseURI).href)}');--ink:${esc(d.markOnDark)}"></span>`;
    return `<img class="${cls || 'divmark'}" src="${esc(d.mark)}" alt="${esc(d.name)}">`;
  };
})();
