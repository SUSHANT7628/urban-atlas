/* ECharts wrappers. Colours are read from CSS variables at render time, so a theme switch re-renders correctly. */
(function (A) {
  const live = new Map();
  const ro = new ResizeObserver(entries => entries.forEach(e => live.get(e.target)?.resize()));

  A.disposeCharts = () => { live.forEach((c, el) => { ro.unobserve(el); c.dispose(); }); live.clear(); };

  A.disposeOne = el => { if (typeof el === 'string') el = A.$(el); const c = el && live.get(el); if (c) { ro.unobserve(el); c.dispose(); live.delete(el); } };

  A.chart = (el, option) => {
    if (typeof el === 'string') el = A.$(el);
    if (!el || !window.echarts) { if (el) el.innerHTML = '<div class="empty">Charts need the ECharts library, which could not load.</div>'; return null; }
    let c = live.get(el);
    if (!c) { c = echarts.init(el, null, { renderer: 'svg' }); live.set(el, c); ro.observe(el); }
    c.setOption(Object.assign(A.base(), option), true);
    return c;
  };

  A.base = () => ({
    animationDuration: A.reduceMotion() ? 0 : 450,
    animationDurationUpdate: A.reduceMotion() ? 0 : 300,
    textStyle: { fontFamily: '"Public Sans", system-ui, sans-serif', color: A.css('--muted') },
    tooltip: {
      backgroundColor: A.css('--panel'), borderColor: A.css('--line'), borderWidth: 1, padding: [8, 10],
      textStyle: { color: A.css('--ink'), fontSize: 13 }, extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.14);border-radius:8px;',
    },
  });

  const axisLine = () => ({ lineStyle: { color: A.css('--line-2') } });
  const split = () => ({ lineStyle: { color: A.css('--line') } });
  const key = (color, line) => `<span style="display:inline-block;width:${line ? 14 : 9}px;height:${line ? 3 : 9}px;border-radius:2px;background:${color};margin-right:7px;vertical-align:${line ? 3 : 0}px"></span>`;

  // One row per category, one dot per city: shows the spread between cities.
  A.strip = (el, cats, cities, getVal) => A.chart(el, {
    grid: { left: 110, right: 24, top: 10, bottom: 78 },
    legend: { bottom: 0, icon: 'circle', itemWidth: 10, itemHeight: 10, textStyle: { color: A.css('--ink-2'), fontSize: 12.5 } },
    xAxis: { type: 'value', min: 0, max: 100, splitLine: split(), axisLine: { show: false }, axisLabel: { fontSize: 12 } },
    yAxis: { type: 'category', data: cats.map(A.short), inverse: true, axisTick: { show: false }, axisLine: axisLine(), axisLabel: { color: A.css('--ink'), fontWeight: 600, fontSize: 13 } },
    tooltip: { trigger: 'item', formatter: p => `<b style="font-size:15px">${Math.round(p.value[0])}</b> / 100<br>${key(p.color)}${A.esc(p.seriesName)}, ${A.esc(cats[p.value[1]])}` },
    series: cities.map(c => ({
      name: c, type: 'scatter', symbolSize: 13, data: cats.map((t, k) => [getVal(c, t), k]).filter(d => d[0] != null),
      itemStyle: { color: A.cityHex(c), borderColor: A.css('--panel'), borderWidth: 2 },
      emphasis: { focus: 'series', scale: 1.4 }, blur: { itemStyle: { opacity: 0.15 } },
    })),
  });

  // Readiness quadrant: basic services (x) vs smart tech (y)
  A.quadrant = (el, cities, R, onClick) => {
    const ch = A.chart(el, {
      grid: { left: 52, right: 24, top: 18, bottom: 46 },
      xAxis: { type: 'value', min: 0, max: 100, name: 'Basic-service readiness', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: A.css('--ink-2'), fontWeight: 600 }, splitLine: split(), axisLine: { show: false } },
      yAxis: { type: 'value', min: 0, max: 100, name: 'Smart-tech coverage', nameLocation: 'middle', nameGap: 36, nameTextStyle: { color: A.css('--ink-2'), fontWeight: 600 }, splitLine: split(), axisLine: { show: false } },
      tooltip: { formatter: p => p.seriesType === 'scatter' ? `<b>${A.esc(p.name)}</b><br>Basic services <b>${Math.round(p.value[0])}</b><br>Smart tech <b>${Math.round(p.value[1])}</b><br>Gate checks passed <b>${R[p.name].passed} of ${R[p.name].total}</b>` : '' },
      series: [
        { type: 'line', silent: true, symbol: 'none', data: [[0, 0], [100, 100]], lineStyle: { color: A.css('--line-2'), type: 'dashed', width: 1 } },
        { type: 'custom', silent: true, renderItem: (p, api) => {
            const a = api.coord([0, 10]), b = api.coord([90, 100]), c = api.coord([0, 100]);
            return { type: 'polygon', shape: { points: [a, b, c] }, style: { fill: A.css('--bad-soft'), opacity: .7 }, z2: -1 };
          }, data: [[0, 0]] },
        { type: 'scatter', symbolSize: 16, data: cities.map(c => ({ name: c, value: [R[c].foundation, R[c].smart], itemStyle: { color: A.cityHex(c), borderColor: A.css('--panel'), borderWidth: 2 } })),
          label: { show: true, position: 'right', formatter: '{b}', color: A.css('--ink'), fontWeight: 600, fontSize: 12.5 },
          labelLayout: { hideOverlap: false, moveOverlap: 'shiftY' }, emphasis: { scale: 1.3 } },
      ],
      graphic: [
        { type: 'text', left: 62, top: 26, style: { text: 'Technology ahead of basics', fill: A.css('--bad'), fontSize: 12.5, fontWeight: 600, fontFamily: 'Public Sans, system-ui, sans-serif' } },
        { type: 'text', right: 34, bottom: 56, style: { text: 'Basics ahead of technology', fill: A.css('--good'), fontSize: 12.5, fontWeight: 600, fontFamily: 'Public Sans, system-ui, sans-serif' } },
      ],
    });
    if (ch && onClick) ch.on('click', p => p.seriesType === 'scatter' && onClick(p.name));
    return ch;
  };

  // Radar: axes 0-100, one polygon per city
  A.radar = (el, axes, series, opts = {}) => A.chart(el, {
    legend: opts.legend === false ? undefined : { bottom: 0, icon: 'roundRect', itemWidth: 16, itemHeight: 4, textStyle: { color: A.css('--ink-2'), fontSize: 13 } },
    tooltip: { trigger: 'item', formatter: p => `<b>${A.esc(p.name)}</b><br>` + axes.map((a, k) => `${A.esc(a)}: <b>${p.value[k] == null ? '–' : Math.round(p.value[k])}</b>`).join('<br>') },
    radar: {
      center: ['50%', opts.legend === false ? '50%' : '47%'], radius: opts.radius || '64%', splitNumber: 4, shape: 'polygon',
      indicator: axes.map(a => ({ name: a, max: 100, min: 0 })),
      axisName: { color: A.css('--ink-2'), fontSize: 12.5, fontWeight: 600, formatter: v => v.length > 18 ? v.replace(/(.{1,18})(\s|$)/g, '$1\n').trim() : v },
      splitLine: { lineStyle: { color: A.css('--line') } }, splitArea: { show: false }, axisLine: { lineStyle: { color: A.css('--line') } },
    },
    series: [{
      type: 'radar', symbolSize: 6, emphasis: { focus: 'self', lineStyle: { width: 3 } },
      data: series.map(s => ({ name: s.name, value: s.values.map(v => v ?? 0),
        lineStyle: { color: s.color, width: 2, type: s.dash ? 'dashed' : 'solid' }, itemStyle: { color: s.color },
        areaStyle: s.dash ? undefined : { color: s.color, opacity: s.fill ?? 0.1 }, symbol: s.dash ? 'none' : 'circle' })),
    }],
  });

  // Horizontal bars, best first. items: [{name, value, label, color}]
  A.hbars = (el, items, opts = {}) => A.chart(el, {
    grid: { left: 92, right: 110, top: 4, bottom: 4 },
    xAxis: { type: 'value', show: false, max: opts.max },
    yAxis: { type: 'category', inverse: true, data: items.map(i => i.name), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: A.css('--ink'), fontSize: 13, fontWeight: 500 } },
    tooltip: { trigger: 'item', formatter: p => `<b style="font-size:15px">${A.esc(items[p.dataIndex].label)}</b><br>${A.esc(items[p.dataIndex].name)}${items[p.dataIndex].rating ? ` <span style="color:${A.css('--muted')}">${A.esc(items[p.dataIndex].rating)}</span>` : ''}` },
    series: [{ type: 'bar', barWidth: 14, data: items.map(i => ({ value: i.value, itemStyle: { color: i.color, borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: 'right', color: A.css('--ink-2'), fontSize: 12.5, formatter: p => items[p.dataIndex].label.length > 16 ? items[p.dataIndex].label.slice(0, 15) + '…' : items[p.dataIndex].label } }],
  });
})(window.A);
