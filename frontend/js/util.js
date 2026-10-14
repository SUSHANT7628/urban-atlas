/* Shared state and helpers. Plain scripts (no bundler) so the app runs straight from FastAPI. */
window.A = window.A || {};
(function (A) {
  A.state = { ds: null, byId: {}, lastLoaded: null, static: !!window.__ATLAS_STATIC__ };

  A.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  A.$ = (sel, el = document) => el.querySelector(sel);
  A.$$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  A.css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  A.reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  A.avg = a => { a = a.filter(x => x != null && !isNaN(x)); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
  A.round = v => v == null ? '–' : Math.round(v);
  A.SCORE = { 'Exceptional': 6, 'High': 5, 'Moderate-High': 4, 'Moderate': 3, 'Low-Moderate': 2, 'Low': 1 };
  A.LABELS = ['Exceptional', 'High', 'Moderate-High', 'Moderate', 'Low-Moderate', 'Low'];
  A.SHORT = { 'Economic Opportunities': 'Economy', 'Environment & Resources': 'Environment', 'Governance & Technology': 'Governance',
    'Mobility & Accessibility': 'Mobility', 'Social Infrastructure': 'Social', 'Urban Infrastructure': 'Urban infra' };
  A.short = t => A.SHORT[t] || t;

  // ---- colours: city colour follows the entity (fixed config order), never its rank
  A.cityVar = c => { const i = (A.state.ds?.city_order || []).indexOf(c); return `var(--c${i >= 0 && i < 8 ? i + 1 : 9})`; };
  A.cityHex = c => { const i = (A.state.ds?.city_order || []).indexOf(c); return A.css(`--c${i >= 0 && i < 8 ? i + 1 : 9}`); };
  A.rVar = l => A.SCORE[l] ? `var(--r${A.SCORE[l]})` : 'var(--r0)';
  A.rInk = l => A.SCORE[l] ? `var(--r${A.SCORE[l]}-ink)` : 'var(--muted)';
  A.scoreBand = s => s == null ? 0 : s >= 83 ? 6 : s >= 67 ? 5 : s >= 50 ? 4 : s >= 34 ? 3 : s >= 17 ? 2 : 1;
  A.sVar = s => `var(--r${A.scoreBand(s)})`;
  A.sInk = s => `var(--r${A.scoreBand(s)}-ink)`;

  A.timeAgo = iso => {
    if (!iso) return '';
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return `${Math.floor(d / 60)} min ago`;
    if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  A.dateTime = iso => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  A.ind = id => A.state.byId[id];
  A.findInd = match => (A.state.ds.indicators.find(i => i.name.startsWith(match)) || A.state.ds.indicators.find(i => i.name.includes(match)));

  // ---- theme-score glyph: one petal per theme, length = score. The Atlas' signature mark.
  A.glyph = (city, size = 96, opts = {}) => {
    const ds = A.state.ds, th = ds.themes, n = th.length, c = ds.city[city];
    const cx = size / 2, cy = size / 2, R = size / 2 - (opts.labels ? 16 : 3);
    const pt = (k, v) => { const a = -Math.PI / 2 + k * 2 * Math.PI / n; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
    const poly = vals => vals.map((v, k) => pt(k, Math.max(0.04, (v ?? 0) / 100)).map(x => x.toFixed(1)).join(',')).join(' ');
    const pad = opts.labels ? 46 : 0;
    let s = `<svg class="glyph" viewBox="${-pad} 0 ${size + 2 * pad} ${size}" width="${size + 2 * pad}" height="${size}" style="--cc:${A.cityVar(city)}" role="img" aria-label="${A.esc(city)} theme profile">`;
    [0.5, 1].forEach(r => s += `<polygon class="ring" points="${th.map((_, k) => pt(k, r).join(',')).join(' ')}"/>`);
    th.forEach((_, k) => { const [x, y] = pt(k, 1); s += `<line class="axis" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`; });
    if (opts.avg) s += `<polygon class="avg" points="${poly(opts.avg)}"/>`;
    s += `<polygon class="shape" points="${poly(th.map(t => c.themes[t]))}"/>`;
    if (opts.labels) th.forEach((t, k) => { const [x, y] = pt(k, 1.13); const anc = Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end'; s += `<text x="${x}" y="${y + 3}" text-anchor="${anc}">${A.esc(A.short(t))}</text>`; });
    return s + '</svg>';
  };

  A.ratingPill = l => l ? `<span class="badge" style="background:${A.rVar(l)};color:${A.rInk(l)}">${A.esc(l)}</span>` : '<span class="badge">Not rated</span>';
  A.ratingLegend = () => A.LABELS.map(l => `<span><i class="sw" style="background:${A.rVar(l)}"></i>${l}</span>`).join('') + `<span><i class="sw" style="background:var(--r0)"></i>Not rated</span>`;
  A.scoreLegend = () => [[0, 16], [17, 33], [34, 49], [50, 66], [67, 82], [83, 100]].map(([a, b]) => `<span><i class="sw" style="background:${A.sVar((a + b) / 2)}"></i>${a}–${b}</span>`).join('');

  A.toast = (msg, ms = 4200) => { const t = A.$('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(A._tt); A._tt = setTimeout(() => t.hidden = true, ms); };

  // lightweight tooltip for SVG/HTML marks (charts use ECharts' own)
  A.tip = (e, html) => { const t = A.$('#tip'); t.innerHTML = html; t.hidden = false; const x = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8), y = Math.min(e.clientY + 14, innerHeight - t.offsetHeight - 8); t.style.left = x + 'px'; t.style.top = y + 'px'; };
  A.untip = () => { A.$('#tip').hidden = true; };
})(window.A);
