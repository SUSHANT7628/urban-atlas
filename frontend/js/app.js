/* Boot, routing, live refresh. */
(function (A) {
  const POLL_MS = 15000;

  async function fetchDashboard() {
    if (window.__ATLAS_STATIC__) return window.__ATLAS_STATIC__;
    const r = await fetch('api/dashboard', { cache: 'no-store' });
    if (!r.ok) throw new Error(`Server answered ${r.status}`);
    return r.json();
  }

  function setData(ds) {
    A.state.ds = ds;
    A.state.byId = Object.fromEntries(ds.indicators.map(i => [i.id, i]));
    A.state.lastLoaded = ds.meta.loaded_at;
  }

  function rail() {
    const d = A.state.ds, cur = route();
    A.$('#cityList').innerHTML = d.cities.map(c => {
      const x = d.city[c];
      return `<a class="city-link" href="#/city/${encodeURIComponent(c)}" ${cur.view === 'city' && decodeURIComponent(cur.arg || '').toLowerCase() === c.toLowerCase() ? 'aria-current="page"' : ''}>
        <span class="rk">${x.rank}</span>${A.glyph(c, 34)}<span class="nm">${A.esc(c)}<small>${A.esc(x.state)}</small></span><span class="sc">${A.round(x.overall)}</span></a>`;
    }).join('');
    A.$('#railFoot').innerHTML = A.state.static
      ? 'Static preview. Run the backend to edit data.'
      : `${d.meta.files.length} workbooks in <code style="background:#ffffff14;color:inherit">data/cities</code><br><a href="#/data">Update data</a>`;
  }

  function sync(state) {
    const el = A.$('#sync');
    if (A.state.static) { el.className = 'sync static'; el.innerHTML = '<i></i><span>Static preview</span>'; return; }
    if (state === 'err') { el.className = 'sync err'; el.innerHTML = '<i></i><span>Server unreachable</span>'; return; }
    el.className = 'sync'; el.innerHTML = `<i></i><span>Live, updated ${A.esc(A.timeAgo(A.state.lastLoaded))}</span>`;
    el.title = `Data loaded ${A.dateTime(A.state.lastLoaded)}. Checks for workbook changes every ${POLL_MS / 1000} s.`;
  }

  function route() {
    const h = (location.hash || '#/overview').slice(2).split('/');
    return { view: h[0] || 'overview', arg: h[1] };
  }

  function render() {
    const { view, arg } = route();
    A.closeDrawer?.();
    A.disposeCharts();
    const name = A.views[view] ? view : 'overview';
    A.$$('#views a').forEach(a => { if (a.dataset.v === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const arg2 = arg ? decodeURIComponent(arg) : undefined;
    try { A.views[name]({ city: arg2, id: arg2 }); }
    catch (e) { console.error(e); A.$('#view').innerHTML = `<div class="empty">This view could not be drawn: ${A.esc(e.message)}</div>`; }
    rail();
    document.title = `${name === 'city' && arg2 ? arg2 : name[0].toUpperCase() + name.slice(1)} | Urban Atlas`;
  }

  A.refresh = async (rerender = true) => {
    const prev = A.state.lastLoaded;
    const ds = await fetchDashboard();
    setData(ds);
    sync();
    if (rerender) { const y = scrollY; render(); scrollTo(0, y); }
    return prev !== ds.meta.loaded_at;
  };

  async function poll() {
    if (A.state.static) return;
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      const j = await r.json();
      if (j.loaded_at !== A.state.lastLoaded) {
        const before = A.state.ds.history[0]?.ts;
        await A.refresh(true);
        const fresh = A.state.ds.history.filter(e => e.type === 'value' && (!before || e.ts > before));
        const cities = [...new Set(fresh.map(e => e.city))];
        A.toast(fresh.length ? `Data updated: ${fresh.length} value${fresh.length > 1 ? 's' : ''} changed in ${cities.join(', ')}.` : 'Data reloaded.');
      } else sync();
    } catch (e) { sync('err'); }
  }

  // theme
  try { const t = localStorage.getItem('atlas-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
  A.$('#themeBtn').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('atlas-theme', next); } catch (e) {}
    render();
  };

  addEventListener('hashchange', () => { render(); A.$('#view').focus({ preventScroll: true }); scrollTo(0, 0); });

  (async () => {
    try { setData(await fetchDashboard()); }
    catch (e) { A.$('#view').innerHTML = `<div class="empty">Could not load data: ${A.esc(e.message)}. Is the backend running?</div>`; sync('err'); return; }
    sync(); render();
    if (!A.state.static) setInterval(poll, POLL_MS);
  })();
})(window.A);
