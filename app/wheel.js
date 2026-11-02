/* Radialmenü: wird im Hauptprozess (Geometrie) und in den Fenstern (Darstellung) genutzt. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Wheel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const S = 340, C = 170, RO = 162, RI = 66;

  function hoverAt(dx, dy, n) {
    if (Math.hypot(dx, dy) < RI * 0.85) return -1;
    const step = (2 * Math.PI) / n;
    let a = Math.atan2(dy, dx) + Math.PI / 2 + step / 2;
    a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return Math.floor(a / step) % n;
  }
  function wedgePath(i, n) {
    const step = (2 * Math.PI) / n;
    const a0 = -Math.PI / 2 + (i - 0.5) * step + 0.012, a1 = -Math.PI / 2 + (i + 0.5) * step - 0.012;
    const p = (r, a) => [(C + r * Math.cos(a)).toFixed(1), (C + r * Math.sin(a)).toFixed(1)];
    const lg = a1 - a0 > Math.PI ? 1 : 0, A = p(RI, a0), B = p(RO, a0), D = p(RO, a1), E = p(RI, a1);
    return `M${A} L${B} A${RO} ${RO} 0 ${lg} 1 ${D} L${E} A${RI} ${RI} 0 ${lg} 0 ${A}Z`;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* Baut das Rad in container (340x340 Pixel). */
  function mount(container, cfg) {
    const opts = cfg.opts, n = opts.length, mid = (RO + RI) / 2 + 2;
    const wedges = opts.map((o, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n, tx = C + mid * Math.cos(a), ty = C + mid * Math.sin(a);
      return `<g class="wg"><path d="${wedgePath(i, n)}"/><text class="wl" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" dy="${o.s ? '-.1em' : '.35em'}">${esc(o.l)}</text>${o.s ? `<text class="ws" x="${tx.toFixed(1)}" y="${(ty + 11).toFixed(1)}">${esc(o.s)}</text>` : ''}</g>`;
    }).join('');
    container.innerHTML = `<div class="halo"></div><svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${wedges}</svg><div class="hub"><b>${esc(cfg.title)}</b><span></span></div>`;
    const groups = container.querySelectorAll('.wg'), sub = container.querySelector('.hub span');
    const ctl = {
      mode: cfg.mode, hover: -2,
      setHover(i) {
        if (ctl.hover === i) return;
        ctl.hover = i;
        groups.forEach((g, k) => g.classList.toggle('on', k === i));
        ctl.refresh();
      },
      refresh() {
        const i = ctl.hover;
        if (i >= 0) { const o = opts[i]; sub.className = 'go'; sub.textContent = '→ ' + o.l + (o.s && o.id !== 'half' ? ' ' + o.s : ''); }
        else { sub.className = ''; sub.textContent = ctl.mode === 'hold' ? 'Ziehen, dann loslassen' : 'Format anklicken'; }
      },
      setMode(m) { ctl.mode = m; ctl.refresh(); },
    };
    ctl.setHover(-1);
    return ctl;
  }
  return { S, C, RO, RI, hoverAt, mount };
});
