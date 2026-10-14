/* Page renderers. Each takes the route params and fills #view. */
(function (A) {
  const V = A.views = {};
  const ds = () => A.state.ds;
  const E = A.esc;

  // ---------------------------------------------------------------- shared pieces
  const matrix = (cities, cols, get, opts = {}) => {
    let h = `<div class="tablewrap"><table class="matrix"><thead><tr><th>City</th>${cols.map(t => `<th class="num" title="${E(t)}">${E(opts.short === false ? t : A.short(t))}</th>`).join('')}${opts.total ? `<th class="num">${E(opts.total)}</th>` : ''}</tr></thead><tbody>`;
    cities.forEach(c => {
      h += `<tr><td><a class="citycell" href="#/city/${encodeURIComponent(c)}"><span class="dotkey" style="background:${A.cityVar(c)}"></span>${E(c)}</a></td>`;
      const cell = v => `<td class="num" style="padding:3px"><span class="cell-r heat" style="background:${A.sVar(v)};color:${A.sInk(v)}" ${opts.tip ? '' : ''}>${A.round(v)}</span></td>`;
      cols.forEach(t => h += cell(get(c, t)));
      if (opts.total) h += cell(opts.totalGet(c));
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  };

  const feedItem = e => {
    const when = `<span class="when">${E(A.timeAgo(e.ts))}</span>`;
    if (e.type === 'value') return `<li style="--cc:${A.cityVar(e.city)}"><i class="mk"></i><span><b>${E(e.city)}</b> ${E(e.indicator)}<br><del>${E(e.old || '—')}</del> to <ins>${E(e.new || '—')}</ins><span class="muted small"> ${E(e.reason || '')}</span></span>${when}</li>`;
    return `<li><i class="mk"></i><span>${E(e.text || e.type)}</span>${when}</li>`;
  };

  // ---------------------------------------------------------------- OVERVIEW
  V.overview = () => {
    const d = ds(), C = d.cities, T = d.themes;
    const top = C[0], bot = C[C.length - 1];
    const leads = T.filter(t => C.slice().sort((a, b) => d.city[b].themes[t] - d.city[a].themes[t])[0] === top).length;
    const trails = T.filter(t => C.slice().sort((a, b) => d.city[a].themes[t] - d.city[b].themes[t])[0] === bot).length;
    const values = d.history.filter(e => e.type === 'value');
    const rated = C.reduce((s, c) => s + d.city[c].rated, 0);
    const avgTheme = T.map(t => A.avg(C.map(c => d.city[c].themes[t])));
    const widest = T.map(t => { const v = C.map(c => d.city[c].themes[t]).filter(x => x != null); return [t, Math.max(...v) - Math.min(...v)]; }).sort((a, b) => b[1] - a[1])[0];

    A.$('#view').innerHTML = `
      <section class="grid g-hero">
        <div>
          <h1 class="page-title">${E(top)} leads ${leads} of ${T.length} themes; ${E(bot)} trails on ${trails}.</h1>
          <p class="lede">Across ${C.length} cities and ${d.indicators.length} indicators, the widest gap between the best and worst city is in <b>${E(widest[0].toLowerCase())}</b> (${Math.round(widest[1])} points). Scores are relative: 100 means best of these ${C.length} cities.</p>
        </div>
        <div class="facts">
          <div class="fact"><b>${C.length}</b><span>cities</span></div>
          <div class="fact"><b>${d.indicators.length}</b><span>indicators</span></div>
          <div class="fact"><b>${rated.toLocaleString()}</b><span>rated values</span></div>
          <div class="fact"><b>${values.length}</b><span>values updated</span></div>
        </div>
      </section>

      <section class="sec glyphs" aria-label="City profiles">
        ${C.map(c => `<a class="gcard" href="#/city/${encodeURIComponent(c)}" style="--cc:${A.cityVar(c)}">${A.glyph(c, 92, { avg: avgTheme })}<span class="nm">${E(c)}</span><span class="meta">Rank ${d.city[c].rank} of ${C.length}, score ${A.round(d.city[c].overall)}</span></a>`).join('')}
      </section>
      <p class="legend" style="margin-top:8px"><span>Each shape plots a city's six theme scores, clockwise from economy at the top; the dashed outline is the eight-city average.</span></p>

      <section class="grid g-wide sec">
        <div class="panel">
          <div class="ph"><div><h2>Theme scores</h2><p class="sub">Average rating on each theme, scaled 0–100. Select a city to open its profile.</p></div></div>
          ${matrix(C, T, (c, t) => d.city[c].themes[t], { total: 'Overall', totalGet: c => d.city[c].overall })}
          <div class="legend">${A.scoreLegend()}</div>
        </div>
        <div class="panel">
          <div class="ph"><div><h2>How far apart the cities are</h2><p class="sub">Each dot is a city's theme score. Hover a city in the legend to follow it.</p></div></div>
          <div class="chart" id="ovStrip"></div>
        </div>
      </section>

      <section class="grid g-2 sec">
        <div class="panel">
          <div class="ph"><div><h2>Basics before smart technology</h2><p class="sub">Above the diagonal, smart-city systems are further along than water, sewerage, waste and power.</p></div><a class="btn" href="#/readiness">Readiness</a></div>
          <div class="chart" id="ovQuad"></div>
        </div>
        <div class="panel">
          <div class="ph"><div><h2>Recent updates</h2><p class="sub">Values changed in the city workbooks, newest first.</p></div><a class="btn" href="#/data">All updates</a></div>
          <ul class="feed">${d.history.slice(0, 12).map(feedItem).join('') || '<li><span class="muted">No updates yet. Edit a city workbook and the change appears here.</span></li>'}</ul>
        </div>
      </section>

      <section class="sec">
        <div class="ph"><div><h2>Key indicators</h2><p class="sub">Best city first; bar colour is the rating.</p></div><a class="btn" href="#/indicators">All indicators</a></div>
        <div class="grid g-3" id="ovKeys"></div>
        <div class="legend">${A.ratingLegend()}</div>
      </section>`;

    A.strip('#ovStrip', T, A.state.ds.city_order.filter(c => C.includes(c)), (c, t) => d.city[c].themes[t]);
    if (d.readiness?.cities) A.quadrant('#ovQuad', C, d.readiness.cities, c => location.hash = `#/city/${encodeURIComponent(c)}`);
    const keys = ['City GDP', 'Poverty', 'Air Quality Index', 'Congestion Index (Peak', 'Households Connected to Piped', 'Sewerage Network Coverage'];
    const host = A.$('#ovKeys');
    keys.map(A.findInd).filter(Boolean).forEach((i, k) => {
      const div = document.createElement('div'); div.className = 'panel';
      div.innerHTML = `<h3>${E(i.name.replace(/\s*\(.*?\)\s*/g, ' ').trim())}</h3><p class="sub">${i.direction === 'lower' ? 'Lower is better' : 'Higher is better'}</p><div class="chart short" id="ovK${k}"></div>`;
      host.appendChild(div);
      A.indicatorBars(`#ovK${k}`, i);
    });
  };

  A.indicatorBars = (el, i) => {
    const C = ds().cities;
    const items = C.filter(c => i.num[c] != null).sort((a, b) => (i.score[b] ?? -1) - (i.score[a] ?? -1))
      .map(c => ({ name: c, value: Math.abs(i.num[c]), label: i.values[c], rating: i.ratings[c], color: A.css(`--r${A.SCORE[i.ratings[c]] || 0}`) }));
    if (!items.length) { A.$(el).innerHTML = '<div class="empty">No numeric values to chart.</div>'; return; }
    A.hbars(el, items);
  };

  // ---------------------------------------------------------------- COMPARE
  const SETS = {
    'Theme scores': null,
    'Liveability': ['Access to Basic Services', 'Slum Population Proportion', 'Air Quality Index', 'Households Connected to Piped', 'Total Registered Doctors', 'Recreational Area Per Capita', 'Public Toilets', 'Congestion Index (Peak'],
    'Economy': ['City GDP', 'Economic Growth Rate', 'Formal Employment Share', 'Income Levels', 'Startup Density', 'Poverty', 'NIRF Ranked', 'Business Establishments'],
    'Mobility': ['Congestion Index (Peak', 'Coverage of MRT', 'Footpath Coverage', 'Cycle Track', 'Multilevel Parking', 'Intelligent Traffic', 'Road Capacity Adequacy', 'Proximity to MRT'],
    'Environment': ['Air Quality Index', 'Green Cover', 'Recycling Rate', 'Sewage Treatment Efficiency', 'Waste Collection Coverage', 'Grid Integration', 'RWH Coverage', 'Landfill Dependency'],
    'Basic services': ['Households Connected to Piped', 'Potable Water Supplied', 'Sewerage Network Coverage', 'Public Toilets', 'Average Supply Hours', 'Healthcare Facility Density', 'Ration Shops', 'Public Expenditure Per Student'],
    'My selection': 'custom',
  };
  const cmp = A.cmp = A.cmp || { cities: null, set: 'Theme scores', custom: [], q: '' };
  const shortName = n => n.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

  V.compare = () => {
    const d = ds();
    if (!cmp.cities) cmp.cities = [d.cities[0], d.cities[2], d.cities[Math.floor(d.cities.length / 2)], d.cities[d.cities.length - 1]].filter((c, k, a) => c && a.indexOf(c) === k);
    cmp.cities = cmp.cities.filter(c => d.cities.includes(c));
    A.$('#view').innerHTML = `
      <h1 class="page-title">Compare cities</h1>
      <p class="lede">Pick the cities, then the measures. Each measure is scaled 0–100 among all ${d.cities.length} cities, so different units can sit on one chart.</p>
      <div class="panel sec">
        <div class="toolbar" style="margin:0 0 12px"><span class="field">Cities</span><div class="chips" id="cmpCities">${d.city_order.map(c => `<button type="button" class="chip" style="--cc:${A.cityVar(c)}" data-c="${E(c)}" aria-pressed="${cmp.cities.includes(c)}"><i></i>${E(c)}</button>`).join('')}</div></div>
        <div class="toolbar" style="margin:0"><span class="field">Measures</span><div class="seg" id="cmpSets">${Object.keys(SETS).map(k => `<button type="button" data-k="${E(k)}" aria-pressed="${k === cmp.set}">${E(k)}</button>`).join('')}</div></div>
        <div id="picker" ${cmp.set === 'My selection' ? '' : 'hidden'} style="margin-top:14px"></div>
      </div>
      <section class="grid g-wide sec">
        <div class="panel"><div class="ph"><div><h2 id="radarTitle"></h2><p class="sub">Outer edge = best of all cities on that measure.</p></div></div><div class="chart tall" id="cmpRadar"></div></div>
        <div class="panel"><div class="ph"><div><h2>Overall on these measures</h2><p class="sub">Average 0–100 score. Your cities in colour, the rest for context.</p></div></div><div class="chart tall" id="cmpRank"></div></div>
      </section>
      <section class="panel flush sec"><div class="ph"><div><h2>Side by side</h2><p class="sub">Recorded values. The bar under each is its 0–100 score; the leader on each row is marked.</p></div></div><div class="tablewrap" id="cmpTable"></div></section>`;

    A.$$('#cmpCities .chip').forEach(b => b.onclick = () => {
      const c = b.dataset.c;
      if (cmp.cities.includes(c)) { if (cmp.cities.length <= 2) return A.toast('Keep at least two cities to compare.'); cmp.cities = cmp.cities.filter(x => x !== c); }
      else cmp.cities.push(c);
      b.setAttribute('aria-pressed', String(cmp.cities.includes(c))); draw();
    });
    A.$$('#cmpSets button').forEach(b => b.onclick = () => {
      cmp.set = b.dataset.k; A.$$('#cmpSets button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      A.$('#picker').hidden = cmp.set !== 'My selection';
      if (cmp.set === 'My selection' && !cmp.custom.length) cmp.custom = SETS.Liveability.map(m => A.findInd(m)?.id).filter(Boolean);
      picker(); draw();
    });
    picker(); draw();
  };

  function picker() {
    const d = ds(), el = A.$('#picker'); if (el.hidden) return;
    const q = cmp.q.toLowerCase();
    const groups = d.themes.map(t => [t, d.indicators.filter(i => i.theme === t && i.rated && (!q || i.name.toLowerCase().includes(q)))]).filter(g => g[1].length);
    el.innerHTML = `<div class="toolbar" style="margin-bottom:8px"><input type="search" id="pickQ" placeholder="Find a measure" value="${E(cmp.q)}" aria-label="Find a measure"><span class="muted small">${cmp.custom.length} of 10 chosen</span><button class="btn" type="button" id="pickClear">Clear</button></div>
      <div style="max-height:260px;overflow:auto;columns:3 260px;column-gap:24px">${groups.map(([t, L]) => `<div style="break-inside:avoid;margin-bottom:10px"><div class="small muted" style="font-weight:700;margin-bottom:2px">${E(t)}</div>${L.map(i => { const on = cmp.custom.includes(i.id); return `<label class="small" style="display:flex;gap:6px;padding:2px 0;cursor:pointer"><input type="checkbox" data-id="${E(i.id)}" ${on ? 'checked' : ''} ${!on && cmp.custom.length >= 10 ? 'disabled' : ''}>${E(i.name)}</label>`; }).join('')}</div>`).join('') || '<div class="empty">No measures match.</div>'}</div>`;
    A.$('#pickQ').oninput = e => { cmp.q = e.target.value; picker(); A.$('#pickQ').focus(); A.$('#pickQ').setSelectionRange(cmp.q.length, cmp.q.length); };
    A.$('#pickClear').onclick = () => { cmp.custom = []; picker(); draw(); };
    A.$$('#picker input[type=checkbox]').forEach(cb => cb.onchange = () => { const id = cb.dataset.id; cmp.custom = cb.checked ? [...cmp.custom, id] : cmp.custom.filter(x => x !== id); picker(); draw(); });
  }

  function params() {
    const d = ds();
    if (cmp.set === 'Theme scores') return d.themes.map(t => ({ label: t, score: c => d.city[c].themes[t], value: c => `${A.round(d.city[c].themes[t])} / 100` }));
    const list = cmp.set === 'My selection' ? cmp.custom.map(A.ind).filter(Boolean) : SETS[cmp.set].map(A.findInd).filter(Boolean);
    return list.map(i => ({ label: shortName(i.name), full: i.name, dir: i.direction, score: c => i.score[c], value: c => i.values[c], rating: c => i.ratings[c] }));
  }

  function draw() {
    const d = ds(), P = params(), sel = cmp.cities;
    A.$('#radarTitle').textContent = cmp.set === 'My selection' ? 'Profile on your measures' : `${cmp.set} profile`;
    if (P.length < 3) { A.disposeOne('#cmpRadar'); A.$('#cmpRadar').innerHTML = '<div class="empty">Choose at least three measures to draw the profile.</div>'; }
    else A.radar('#cmpRadar', P.map(p => p.label), sel.map(c => ({ name: c, color: A.cityHex(c), values: P.map(p => p.score(c)) })));
    const comp = {}; d.cities.forEach(c => comp[c] = A.avg(P.map(p => p.score(c))));
    const ord = d.cities.slice().sort((a, b) => (comp[b] ?? -1) - (comp[a] ?? -1));
    if (P.length) A.hbars('#cmpRank', ord.map(c => ({ name: c, value: comp[c] ?? 0, label: `${A.round(comp[c])}`, color: sel.includes(c) ? A.cityHex(c) : A.css('--r0') })), { max: 100 });
    else { A.disposeOne('#cmpRank'); A.$('#cmpRank').innerHTML = '<div class="empty">Choose measures to rank the cities.</div>'; }
    const wins = {}; sel.forEach(c => wins[c] = 0);
    let h = `<table><thead><tr><th>Measure</th>${sel.map(c => `<th><span class="dotkey" style="background:${A.cityVar(c)}"></span>${E(c)}</th>`).join('')}</tr></thead><tbody>`;
    P.forEach(p => {
      const sc = sel.map(c => p.score(c)), mx = Math.max(...sc.filter(v => v != null));
      h += `<tr><td class="ind-name">${E(p.label)}${p.full ? `<small>${E(p.full)}${p.dir === 'lower' ? ', lower is better' : ''}</small>` : ''}</td>`;
      sel.forEach(c => { const s = p.score(c), best = s != null && s === mx; if (best) wins[c]++;
        h += `<td style="min-width:130px${best ? ';background:var(--accent-soft)' : ''}"><div style="display:flex;justify-content:space-between;gap:8px"><span>${E(p.value(c)) || '—'}</span>${best ? '<span class="badge info">Leads</span>' : ''}</div><div class="bar"><i style="width:${s ?? 0}%;background:${A.sVar(s)}"></i></div></td>`; });
      h += '</tr>';
    });
    h += `</tbody><tfoot><tr><td><b>Measures led</b></td>${sel.map(c => `<td><b>${wins[c]}</b> of ${P.length}</td>`).join('')}</tr><tr><td><b>Overall</b></td>${sel.map(c => `<td><b>${A.round(comp[c])}</b> / 100</td>`).join('')}</tr></tfoot></table>`;
    A.$('#cmpTable').innerHTML = P.length ? h : '<div class="empty">Choose measures to compare.</div>';
  }

  // ---------------------------------------------------------------- CITY
  const VERDICT = {
    ready: ['Ready to scale smart services', 'Every basic-service check is met. Smart systems can now be scaled city-wide, starting with those that improve service delivery.'],
    targeted: ['Targeted smart use only', 'Close the remaining basic-service gaps first; add smart tools only where they directly improve a service.'],
    fix: ['Fix foundations first', 'Several basic services are below the floor. Use existing command-centre capacity to monitor them and pause new smart-layer purchases.'],
    hold: ['Hold new smart spending', 'Most basic services are below the floor. Direct funds to water, sewerage, waste, power and drainage before new smart-city systems.'],
  };
  A.VERDICT = VERDICT;

  V.city = ({ city }) => {
    const d = ds(), name = d.cities.find(c => c.toLowerCase() === (city || '').toLowerCase());
    if (!name) { A.$('#view').innerHTML = `<div class="empty">No workbook is loaded for “${E(city)}”. <a href="#/data">Upload one</a>.</div>`; return; }
    const c = d.city[name], T = d.themes, R = d.readiness?.cities?.[name];
    const avgTheme = T.map(t => A.avg(d.cities.map(x => d.city[x].themes[t])));
    const best = T.slice().sort((a, b) => c.themes[b] - c.themes[a])[0], worst = T.slice().sort((a, b) => c.themes[a] - c.themes[b])[0];
    const rated = d.indicators.filter(i => i.ratings[name]);
    const pick = lab => { const L = rated.filter(i => i.ratings[name] === lab); const by = T.map(t => L.filter(i => i.theme === t)); const out = []; for (let k = 0; out.length < L.length; k++) by.forEach(a => a[k] && out.push(a[k])); return out; };
    const top = pick('Exceptional'), low = pick('Low');
    const notes = d.indicators.filter(i => i.note[name]);
    const li = i => `<li><span>${E(i.name)}<span class="t">${E(i.theme)}, ${E(i.topic)}</span></span><span class="v">${E(i.values[name])}</span></li>`;
    const file = d.meta.files.find(f => f.city === name);

    A.$('#view').innerHTML = `
      <section class="panel">
        <div class="city-hero">
          ${A.glyph(name, 188, { labels: true, avg: avgTheme })}
          <div>
            <div class="nm" style="color:${A.cityVar(name)}">${E(name)}</div>
            <div class="st">${E(c.state)}${c.state ? ', ' : ''}ranked <b style="color:var(--ink)">${c.rank} of ${d.cities.length}</b></div>
            <p class="lede" style="font-size:16.5px">Strongest in ${E(best.toLowerCase())}, weakest in ${E(worst.toLowerCase())}. ${c.counts.Exceptional} indicators lead all cities; ${c.counts.Low} sit at the bottom.</p>
            <div class="form-row">${A.state.static ? '' : `<a class="btn" href="api/files/${encodeURIComponent(name)}">Download ${E(name)} workbook</a>`}<a class="btn" href="#/compare" id="cmpThis">Compare</a></div>
          </div>
          <div class="scoreblock"><b>${A.round(c.overall)}</b><span>overall score of 100</span></div>
        </div>
        <div class="theme-tiles sec">${T.map(t => `<div class="tt" style="border-left-color:${A.sVar(c.themes[t])}"><div class="lb">${E(t)}</div><div class="v">#${c.theme_rank[t]}<small>${A.round(c.themes[t])} / 100</small></div></div>`).join('')}</div>
      </section>

      <section class="grid g-wide sec">
        <div class="panel"><div class="ph"><div><h2>Position on each theme</h2><p class="sub">${E(name)} in colour; other cities in grey.</p></div></div><div class="chart" id="cityStrip"></div></div>
        <div class="panel">${R ? `<div class="ph"><div><h2>Smart-city readiness</h2><p class="sub">Basic-service checks against national benchmarks.</p></div></div>
          <div class="verdict ${R.verdict}"><div><b>${E(VERDICT[R.verdict][0])}</b><span class="small">${E(VERDICT[R.verdict][1])}</span>
          <div class="checks" aria-label="${R.passed} of ${R.total} checks passed">${R.checks.map(k => `<span class="check ${k.passed ? 'on' : ''}" title="${E(k.label)}: ${k.passed ? 'met' : 'not met'}">${k.passed ? '✓' : '✕'}</span>`).join('')}</div>
          <span class="small">${R.passed} of ${R.total} checks met</span></div></div>
          <div class="pair"><span>Basic services</span><div class="bar"><i style="width:${R.foundation}%;background:var(--accent)"></i></div><b>${A.round(R.foundation)}</b></div>
          <div class="pair"><span>Smart tech</span><div class="bar"><i style="width:${R.smart}%;background:var(--c7)"></i></div><b>${A.round(R.smart)}</b></div>
          <a class="btn sec" href="#/readiness/${encodeURIComponent(name)}">Full action plan</a>` : '<div class="empty">Readiness needs config/readiness.json.</div>'}</div>
      </section>

      ${R ? `<section class="panel sec"><div class="ph"><div><h2>What to fix first</h2><p class="sub">Largest gaps to the benchmark in each phase. Phase 1 must be met before new smart-city spending.</p></div></div>
        <div class="phase-cols">${[1, 2, 3].map(ph => `<div><h3 style="margin-bottom:4px">Phase ${ph}: ${['Basic services', 'Liveable and inclusive', 'Clean and resilient'][ph - 1]}</h3>${R.actions.filter(a => a.phase === ph && a.score < 90).slice(0, 4).map(a => `<div class="act"><div class="t">${E(a.action)}</div><div class="m"><span>${E(a.label)}: ${E(a.now)}</span><span>target ${E(a.target)}</span></div><div class="bar"><i style="width:${a.score}%;background:${A.sVar(a.score)}"></i></div></div>`).join('') || '<p class="muted small">On track in this phase.</p>'}</div>`).join('')}</div></section>` : ''}

      <section class="grid g-2 sec">
        <div class="panel"><div class="ph"><div><h2>Where ${E(name)} leads</h2><p class="sub">${top.length} indicators rated Exceptional.</p></div></div><ul class="rows">${top.slice(0, 8).map(li).join('') || '<li class="muted">None.</li>'}</ul></div>
        <div class="panel"><div class="ph"><div><h2>Where ${E(name)} lags</h2><p class="sub">${low.length} indicators rated Low.</p></div></div><ul class="rows">${low.slice(0, 8).map(li).join('') || '<li class="muted">None.</li>'}</ul></div>
      </section>

      <section class="panel sec"><details><summary><b>Verification notes (${notes.length})</b> <span class="muted small">from the cross-check of this city's data</span></summary>
        <ul class="rows" style="margin-top:8px">${notes.map(i => `<li><span>${E(i.name)}<span class="t">${E(i.note[name])}</span></span><span class="v">${E(i.values[name])}</span></li>`).join('') || '<li class="muted">No notes.</li>'}</ul></details>
        ${file ? `<p class="small muted" style="margin:10px 0 0">Source file <code>${E(file.file)}</code>, last changed ${E(A.dateTime(file.modified))}.</p>` : ''}</section>`;

    A.$('#cmpThis').onclick = () => { cmp.cities = [name, ...(cmp.cities || d.cities.slice(0, 2)).filter(x => x !== name)].slice(0, 4); };
    A.chart('#cityStrip', {
      grid: { left: 110, right: 24, top: 10, bottom: 30 },
      xAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: A.css('--line') } }, axisLabel: { fontSize: 12 } },
      yAxis: { type: 'category', data: T.map(A.short), inverse: true, axisTick: { show: false }, axisLine: { lineStyle: { color: A.css('--line-2') } }, axisLabel: { color: A.css('--ink'), fontWeight: 600 } },
      tooltip: { trigger: 'item', formatter: p => `<b style="font-size:15px">${Math.round(p.value[0])}</b> / 100<br>${E(p.seriesName)}, ${E(T[p.value[1]])}` },
      series: [...d.cities.filter(x => x !== name).map(x => ({ name: x, type: 'scatter', symbolSize: 10, data: T.map((t, k) => [d.city[x].themes[t], k]), itemStyle: { color: A.css('--r0'), borderColor: A.css('--panel'), borderWidth: 1.5 } })),
        { name, type: 'scatter', symbolSize: 16, z: 5, data: T.map((t, k) => [c.themes[t], k]), itemStyle: { color: A.cityHex(name), borderColor: A.css('--panel'), borderWidth: 2 },
          label: { show: true, position: 'top', formatter: p => Math.round(p.value[0]), color: A.css('--ink'), fontWeight: 700, fontSize: 12 } }],
    });
  };

  // ---------------------------------------------------------------- INDICATORS
  const flt = A.flt = A.flt || { theme: '', topic: '', q: '', src: 'all' };
  V.indicators = ({ id }) => {
    const d = ds();
    if (!flt.theme) flt.theme = d.themes[0];
    const topics = [...new Set(d.indicators.filter(i => i.theme === flt.theme).map(i => i.topic))];
    if (flt.topic && !topics.includes(flt.topic)) flt.topic = '';
    A.$('#view').innerHTML = `
      <h1 class="page-title">All indicators</h1>
      <p class="lede">Every value in the city workbooks. Cell colour is the rating; select a row for its chart, sources and notes.</p>
      <div class="toolbar sec">
        <label class="field">Theme <select id="fTheme">${d.themes.map(t => `<option ${t === flt.theme ? 'selected' : ''}>${E(t)}</option>`).join('')}</select></label>
        <label class="field">Topic <select id="fTopic"><option value="">All topics</option>${topics.map(t => `<option ${t === flt.topic ? 'selected' : ''}>${E(t)}</option>`).join('')}</select></label>
        <input type="search" id="fQ" placeholder="Search all themes" value="${E(flt.q)}" aria-label="Search indicators">
        <div class="seg" id="fSrc" title="How the rating was set">${[['all', 'All'], ['computed', 'Rated from values'], ['file', 'Rated in workbook']].map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${flt.src === k}">${l}</button>`).join('')}</div>
      </div>
      <div class="panel flush"><div class="tablewrap" id="indTable"></div></div>
      <div class="legend">${A.ratingLegend()}</div>`;
    A.$('#fTheme').onchange = e => { flt.theme = e.target.value; flt.topic = ''; V.indicators({}); };
    A.$('#fTopic').onchange = e => { flt.topic = e.target.value; table(); };
    A.$('#fQ').oninput = e => { flt.q = e.target.value; table(); };
    A.$$('#fSrc button').forEach(b => b.onclick = () => { flt.src = b.dataset.k; A.$$('#fSrc button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); table(); });
    table();
    if (id && A.ind(id)) A.openIndicator(id);
  };

  function table() {
    const d = ds(), q = flt.q.trim().toLowerCase();
    const rows = d.indicators.filter(i => (q ? i.name.toLowerCase().includes(q) : i.theme === flt.theme && (!flt.topic || i.topic === flt.topic)) && (flt.src === 'all' || i.rating_source === flt.src));
    const C = d.cities;
    let h = `<table><thead><tr><th>Indicator</th>${C.map(c => `<th>${E(c)}</th>`).join('')}</tr></thead><tbody>`;
    let last = null;
    rows.forEach(i => {
      const grp = q ? `${i.theme}, ${i.topic}` : i.topic;
      if (grp !== last) { h += `<tr><td class="grp" colspan="${C.length + 1}">${E(grp)}</td></tr>`; last = grp; }
      h += `<tr class="clickable" data-id="${E(i.id)}" tabindex="0"><td class="ind-name">${E(i.name)}<small>${i.direction === 'none' ? (i.rated ? 'Rated in workbook' : 'Not rated') : `${i.direction === 'lower' ? 'Lower' : 'Higher'} is better, rated from values`}</small></td>`;
      C.forEach(c => { const r = i.ratings[c]; h += `<td style="padding:3px"><span class="cell-r" style="background:${r ? A.rVar(r) : 'transparent'};color:${r ? A.rInk(r) : 'var(--ink)'}">${E(i.values[c]) || '—'}${r ? `<small>${E(r)}</small>` : ''}</span></td>`; });
      h += '</tr>';
    });
    if (!rows.length) h += `<tr><td colspan="${C.length + 1}" class="empty">No indicators match. Clear the search or change the filter.</td></tr>`;
    A.$('#indTable').innerHTML = h + '</tbody></table>';
    A.$$('#indTable tr.clickable').forEach(tr => { const go = () => A.openIndicator(tr.dataset.id); tr.onclick = go; tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }; });
  }

  A.openIndicator = id => {
    const i = A.ind(id), d = ds(); if (!i) return;
    A.closeDrawer();
    const scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.onclick = A.closeDrawer;
    const dr = document.createElement('aside'); dr.className = 'drawer'; dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-label', i.name);
    const srcs = [...new Set(d.cities.map(c => i.source[c]).filter(Boolean))];
    dr.innerHTML = `<header><div><h2>${E(i.name)}</h2><p class="sub">${E(i.theme)}, ${E(i.topic)}</p></div><button class="icon-btn" type="button" aria-label="Close">✕</button></header>
      <div class="body">
        <div class="chips" style="margin-bottom:12px">${i.direction !== 'none' ? `<span class="badge info">${i.direction === 'lower' ? 'Lower' : 'Higher'} is better</span>` : ''}<span class="badge">${i.rating_source === 'computed' ? 'Ratings recomputed from values' : 'Ratings from the workbook'}</span>${i.basis ? `<span class="badge ${/official|third/i.test(i.basis) ? 'good' : /unverif/i.test(i.basis) ? 'bad' : 'warn'}">${E(i.basis)}</span>` : ''}</div>
        <div class="chart" id="drChart" style="height:300px"></div>
        <h3 class="sec">Values</h3>
        <ul class="rows">${d.cities.slice().sort((a, b) => (i.score[b] ?? -1) - (i.score[a] ?? -1)).map(c => `<li><span><span class="dotkey" style="background:${A.cityVar(c)}"></span>${E(c)}${i.note[c] ? `<span class="t">${E(i.note[c])}</span>` : ''}</span><span class="v">${E(i.values[c]) || '—'} ${A.ratingPill(i.ratings[c])}</span></li>`).join('')}</ul>
        <h3 class="sec">Source</h3>
        ${srcs.length === 1 ? `<p class="small">${E(srcs[0])}</p>` : `<ul class="rows">${d.cities.map(c => `<li><span><b>${E(c)}</b><span class="t">${E(i.source[c] || '—')}</span></span></li>`).join('')}</ul>`}
      </div>`;
    document.body.append(scrim, dr);
    requestAnimationFrame(() => dr.classList.add('open'));
    dr.querySelector('button').onclick = A.closeDrawer;
    dr.querySelector('button').focus();
    A.drawerKey = e => { if (e.key === 'Escape') A.closeDrawer(); };
    document.addEventListener('keydown', A.drawerKey);
    A.indicatorBars('#drChart', i);
    A.$$('#indTable tr').forEach(tr => tr.classList.toggle('sel', tr.dataset.id === id));
  };
  A.closeDrawer = () => {
    A.$$('.drawer,.scrim').forEach(x => { const c = x.querySelector?.('.chart'); if (c) A.disposeOne(c); x.remove(); });
    if (A.drawerKey) document.removeEventListener('keydown', A.drawerKey);
  };

  // ---------------------------------------------------------------- READINESS
  V.readiness = ({ city }) => {
    const d = ds(), R = d.readiness?.cities;
    if (!R) { A.$('#view').innerHTML = '<div class="empty">Readiness needs config/readiness.json.</div>'; return; }
    const C = d.cities, by = v => C.filter(c => R[c].verdict === v);
    const and = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a.join('');
    const ahead = C.filter(c => R[c].gap >= 10);
    const order = C.slice().sort((a, b) => R[b].passed - R[a].passed || R[b].foundation - R[a].foundation);
    const B = d.readiness.benchmarks;
    let focus = C.find(c => c.toLowerCase() === (city || '').toLowerCase()) || order[order.length - 1];

    A.$('#view').innerHTML = `
      <h1 class="page-title">Basics first, then smart technology</h1>
      <p class="lede">${by('ready').length ? `<b>${E(and(by('ready')))}</b> meet every basic-service check and can scale smart services. ` : ''}${by('hold').length ? `<b>${E(and(by('hold')))}</b> should hold new smart-city spending until water, sewerage, waste and drainage improve. ` : ''}${ahead.length ? `In <b>${E(and(ahead))}</b>, smart technology already runs ahead of basic services.` : ''}</p>
      <section class="board sec">${order.map(c => { const r = R[c]; const cls = { ready: 'good', targeted: 'info', fix: 'warn', hold: 'bad' }[r.verdict];
        return `<a class="rcard" href="#/readiness/${encodeURIComponent(c)}" style="--cc:${A.cityVar(c)}"><div class="top"><span class="nm">${E(c)}</span><span class="badge ${cls}">${E(VERDICT[r.verdict][0])}</span></div>
          <div class="checks">${r.checks.map(k => `<span class="check ${k.passed ? 'on' : ''}" title="${E(k.label)}">${k.passed ? '✓' : '✕'}</span>`).join('')}</div>
          <div class="small muted" style="margin-top:4px">${r.passed} of ${r.total} checks met</div>
          <div class="pair"><span>Basic services</span><div class="bar"><i style="width:${r.foundation}%;background:var(--accent)"></i></div><b>${A.round(r.foundation)}</b></div>
          <div class="pair"><span>Smart tech</span><div class="bar"><i style="width:${r.smart}%;background:var(--c7)"></i></div><b>${A.round(r.smart)}</b></div></a>`; }).join('')}</section>

      <section class="panel sec" id="plan"></section>

      <section class="panel flush sec"><div class="ph"><div><h2>Gap to benchmark</h2><p class="sub">0 = severe deficit, 100 = national benchmark met. Benchmarks and gate floors live in <code>config/readiness.json</code>.</p></div></div>
        <div class="tablewrap"><table><thead><tr><th>Phase</th><th>Measure</th><th>Benchmark</th>${C.map(c => `<th class="num">${E(c)}</th>`).join('')}</tr></thead><tbody>
        ${B.map(b => `<tr><td>${b.phase}</td><td class="ind-name">${E(b.label)}<small>${E(b.basis)}${b.gate_floor != null ? `, gate floor ${b.benchmark > b.zero_at ? '≥' : '≤'} ${b.gate_floor}${E(b.unit)}` : ''}</small></td><td>${b.benchmark > b.zero_at ? '≥' : '≤'} ${b.benchmark}${E(b.unit)}</td>${C.map(c => { const a = R[c].actions.find(x => x.indicator_id === b.indicator_id); const s = a?.score; return `<td style="padding:3px"><span class="cell-r" style="text-align:center;background:${A.sVar(s)};color:${A.sInk(s)}">${A.round(s)}<small>${E(a?.now || '')}</small></span></td>`; }).join('')}</tr>`).join('')}
        </tbody></table></div></section>`;

    const plan = c => {
      const r = R[c];
      A.$('#plan').innerHTML = `<div class="ph"><div><h2>Action plan</h2><p class="sub">Choose a city. Actions run in phase order; within a phase, the largest gap comes first.</p></div></div>
        <div class="chips" style="margin-bottom:14px">${d.city_order.filter(x => C.includes(x)).map(x => `<button type="button" class="chip" style="--cc:${A.cityVar(x)}" data-c="${E(x)}" aria-pressed="${x === c}"><i></i>${E(x)}</button>`).join('')}</div>
        <div class="verdict ${r.verdict}" style="margin-bottom:14px"><div><b>${E(c)}: ${E(VERDICT[r.verdict][0])}</b><span class="small">${E(VERDICT[r.verdict][1])}</span></div></div>
        <div class="phase-cols">${[1, 2, 3].map(ph => `<div><h3>Phase ${ph}: ${['Basic services', 'Liveable and inclusive', 'Clean and resilient'][ph - 1]}</h3>${r.actions.filter(a => a.phase === ph).map(a => `<div class="act"><div class="t">${E(a.action)} ${a.score < 40 ? '<span class="badge bad">Critical</span>' : a.score < 70 ? '<span class="badge warn">High</span>' : a.score < 90 ? '<span class="badge info">Medium</span>' : '<span class="badge good">On track</span>'}</div><div class="m"><span>${E(a.label)}: <b style="color:var(--ink)">${E(a.now)}</b></span><span>target ${E(a.target)}</span></div><div class="bar"><i style="width:${a.score}%;background:${A.sVar(a.score)}"></i></div><div class="small muted" style="margin-top:3px">${E(a.scheme)}${a.gate === false ? ', <b style="color:var(--bad)">gate check not met</b>' : ''}</div></div>`).join('')}</div>`).join('')}</div>
        <h3 class="sec">Phase 4: smart and data-driven</h3><p class="small muted" style="margin:4px 0 0">${r.verdict === 'ready' ? 'Unlocked: AI traffic control, city-wide sensors, digital twin and predictive maintenance can be scaled.' : r.verdict === 'targeted' ? 'Partly unlocked: smart tools that directly fix a basic service (metering, leak detection, waste-vehicle tracking, drain sensors) and targeted AI traffic control.' : 'Locked except for smart tools that directly fix a basic service: water metering and leak detection, waste-vehicle tracking, drain-level sensors, prepaid power meters.'}</p>`;
      A.$$('#plan .chip').forEach(b => b.onclick = () => { focus = b.dataset.c; history.replaceState(null, '', `#/readiness/${encodeURIComponent(focus)}`); plan(focus); });
    };
    plan(focus);
    if (city) A.$('#plan').scrollIntoView({ block: 'start', behavior: A.reduceMotion() ? 'auto' : 'smooth' });
  };

  // ---------------------------------------------------------------- DATA
  V.data = () => {
    const d = ds(), st = A.state.static;
    const tok = (() => { try { return sessionStorage.getItem('atlas-token') || ''; } catch (e) { return ''; } })();
    A.$('#view').innerHTML = `
      <h1 class="page-title">Data and updates</h1>
      <p class="lede">The dashboard is built from one Excel workbook per city in <code>data/cities/</code>. Replace or edit a workbook and the dashboard rebuilds within seconds: ratings, scores, ranks and readiness are recalculated across all cities.</p>
      <section class="grid g-wide sec">
        <div class="panel flush"><div class="ph"><div><h2>City workbooks</h2><p class="sub">Loaded ${E(A.dateTime(d.meta.loaded_at))}.</p></div>${st ? '' : '<a class="btn" href="api/export.csv">Export all as CSV</a>'}</div>
          <div class="tablewrap"><table><thead><tr><th>City</th><th>File</th><th>Last changed</th><th class="num">Rows</th><th>Checks</th>${st ? '' : '<th></th>'}</tr></thead><tbody>
          ${d.meta.files.map(f => `<tr><td><span class="dotkey" style="background:${A.cityVar(f.city)}"></span><b>${E(f.city)}</b></td><td class="small">${E(f.file)}</td><td class="small">${E(A.dateTime(f.modified))}</td><td class="num">${f.records}</td><td>${f.warnings.length ? `<span class="badge warn" title="${E(f.warnings.join('\n'))}">${f.warnings.length} warning${f.warnings.length > 1 ? 's' : ''}</span>` : '<span class="badge good">✓ OK</span>'}</td>${st ? '' : `<td><a href="api/files/${encodeURIComponent(f.city)}">Download</a></td>`}</tr>`).join('')}
          </tbody></table></div></div>
        <div class="panel">
          <h2>Update a city</h2>
          ${st ? `<p class="sub">This is a static preview. Run the backend (see README) to upload workbooks.</p>` : !d.admin_enabled ? `<p class="sub">Uploads are switched off. Set <code>ATLAS_ADMIN_TOKEN</code> on the server, or edit the files in <code>data/cities/</code> directly — the dashboard picks up changes on its own.</p>` : `
          <p class="sub">Upload a workbook in the city layout. It replaces that city's file; the old one is kept in <code>data/backups/</code>.</p>
          <div class="drop sec" id="drop" tabindex="0" role="button">Drop an .xlsx here, or select a file<br><span class="small" id="dropName"></span></div>
          <input type="file" id="file" accept=".xlsx" hidden>
          <div class="form-row"><label class="field">City <input type="text" id="upCity" list="cityNames" placeholder="From file name" style="width:150px"></label><datalist id="cityNames">${d.cities.map(c => `<option value="${E(c)}">`).join('')}</datalist>
          <label class="field">Admin token <input type="password" id="upTok" value="${E(tok)}" style="width:150px" autocomplete="off"></label></div>
          <div class="form-row"><button class="btn primary" id="upBtn" type="button" disabled>Upload and rebuild</button><button class="btn" id="reBtn" type="button">Reload files</button></div>
          <div id="upOut"></div>`}
        </div>
      </section>
      <section class="panel flush sec"><div class="ph"><div><h2>Change history</h2><p class="sub">Every value that changed between rebuilds, from <code>data/history.jsonl</code>.</p></div><input type="search" id="hQ" placeholder="Filter by city or indicator" aria-label="Filter history"></div>
        <div class="tablewrap" style="max-height:520px;overflow:auto" id="hist"></div></section>
      <section class="panel quiet sec"><h2>API</h2><p class="sub">The same data is available to other tools.</p>
        <pre>GET  /api/dashboard        everything the dashboard uses
GET  /api/cities/{city}    one city with all indicators and its action plan
GET  /api/indicators?theme=Mobility%20%26%20Accessibility
GET  /api/readiness        basic-service gate and actions
GET  /api/history          change log
GET  /api/export.csv       long-format export
POST /api/admin/upload     multipart: file, city   (header X-Admin-Token)
POST /api/admin/reload                             (header X-Admin-Token)
Interactive docs: /docs</pre></section>`;

    const hist = () => {
      const q = (A.$('#hQ').value || '').toLowerCase();
      const L = d.history.filter(e => !q || JSON.stringify(e).toLowerCase().includes(q));
      A.$('#hist').innerHTML = `<table><thead><tr><th>When</th><th>City</th><th>Indicator</th><th>Before</th><th>After</th><th>How</th></tr></thead><tbody>${L.map(e => e.type === 'value' ? `<tr><td class="small">${E(A.dateTime(e.ts))}</td><td><span class="dotkey" style="background:${A.cityVar(e.city)}"></span>${E(e.city)}</td><td>${E(e.indicator)}<div class="small muted">${E(e.theme)}</div></td><td class="muted">${E(e.old)}</td><td><b>${E(e.new)}</b></td><td class="small muted">${E(e.reason)}</td></tr>` : `<tr><td class="small">${E(A.dateTime(e.ts))}</td><td colspan="5">${E(e.text || e.type)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No changes recorded yet.</td></tr>'}</tbody></table>`;
    };
    A.$('#hQ').oninput = hist; hist();

    if (st || !d.admin_enabled) return;
    let chosen = null;
    const drop = A.$('#drop'), file = A.$('#file');
    const setFile = f => { chosen = f; A.$('#dropName').textContent = f ? f.name : ''; A.$('#upBtn').disabled = !f; };
    drop.onclick = () => file.click(); drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') file.click(); };
    file.onchange = () => setFile(file.files[0]);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); setFile(e.dataTransfer.files[0]); };
    const out = (ok, msg) => A.$('#upOut').innerHTML = `<div class="result ${ok ? 'ok' : 'err'}">${msg}</div>`;
    const token = () => { const t = A.$('#upTok').value.trim(); try { sessionStorage.setItem('atlas-token', t); } catch (e) {} return t; };
    A.$('#upBtn').onclick = async () => {
      const fd = new FormData(); fd.append('file', chosen); fd.append('city', A.$('#upCity').value.trim());
      A.$('#upBtn').disabled = true; A.$('#upBtn').textContent = 'Uploading…';
      try {
        const r = await fetch('api/admin/upload', { method: 'POST', body: fd, headers: { 'X-Admin-Token': token() } });
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || r.statusText);
        out(true, `<b>${E(j.city)}</b> updated: ${j.indicators} indicators read, ${j.values_changed} value${j.values_changed === 1 ? '' : 's'} changed.${j.warnings.length ? `<br><span class="small">${E(j.warnings.slice(0, 4).join(' '))}</span>` : ''}`);
        await A.refresh(true);
      } catch (e) { out(false, E(e.message)); }
      finally { A.$('#upBtn').textContent = 'Upload and rebuild'; A.$('#upBtn').disabled = !chosen; }
    };
    A.$('#reBtn').onclick = async () => {
      try { const r = await fetch('api/admin/reload', { method: 'POST', headers: { 'X-Admin-Token': token() } }); const j = await r.json(); if (!r.ok) throw new Error(j.detail); A.toast('Files reloaded.'); await A.refresh(true); }
      catch (e) { out(false, E(e.message)); }
    };
  };
})(window.A);
