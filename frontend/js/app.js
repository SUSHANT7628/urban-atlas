/* Boot, sign-in, routing, live refresh. */
(function (A) {
  const POLL_MS = 15000;
  let pollTimer = null;

  async function fetchDashboard() {
    if (window.__ATLAS_STATIC__) return window.__ATLAS_STATIC__;
    return A.api('api/dashboard', { cache: 'no-store' });
  }

  function setData(ds) {
    A.state.ds = ds;
    A.state.byId = Object.fromEntries(ds.indicators.map(i => [i.id, i]));
    A.state.lastLoaded = ds.meta.loaded_at;
  }

  // ---------------------------------------------------------------- sign-in screen
  function showLogin(info = {}) {
    clearInterval(pollTimer);
    A.closeDrawer?.(); A.disposeCharts?.();
    document.body.classList.add('signed-out');
    const box = A.$('#login');
    box.hidden = false;
    box.innerHTML = `
      <div class="login-art" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="44" height="44"><circle cx="16" cy="16" r="15" class="brand-disc"/><path d="M16 5l4 8 8 3-8 3-4 8-4-8-8-3 8-3z" class="brand-star"/></svg>
        <div><b>Urban Atlas</b><p>Eight Indian cities compared across 202 indicators, from water and sewerage to jobs, mobility and governance.</p></div>
        <svg class="login-glyph" viewBox="0 0 220 220">${[0.33, 0.66, 1].map(r => `<polygon points="${[0, 1, 2, 3, 4, 5].map(k => { const a = -Math.PI / 2 + k * Math.PI / 3; return `${110 + Math.cos(a) * 100 * r},${110 + Math.sin(a) * 100 * r}`; }).join(' ')}"/>`).join('')}<polygon class="sh" points="${[0.72, 0.9, 0.55, 0.8, 0.62, 0.95].map((v, k) => { const a = -Math.PI / 2 + k * Math.PI / 3; return `${110 + Math.cos(a) * 100 * v},${110 + Math.sin(a) * 100 * v}`; }).join(' ')}"/></svg>
      </div>
      <form class="login-form" id="loginForm" novalidate>
        <h1>Sign in</h1>
        <p class="sub">Viewers can explore every page. Admins can also update city data and manage accounts.</p>
        ${info.has_users === false ? `<div class="result err">No accounts exist yet. On the server, run <code>python scripts/manage_users.py add admin --role admin</code> or set <code>ATLAS_ADMIN_PASSWORD</code> and restart.</div>` : ''}
        ${info.expired ? '<div class="result err">Your session ended. Sign in again to continue.</div>' : ''}
        <label for="lgUser">Username</label><input id="lgUser" type="text" autocomplete="username" required autofocus>
        <label for="lgPw">Password</label><input id="lgPw" type="password" autocomplete="current-password" required>
        <div class="login-err" id="lgErr" role="alert"></div>
        <button class="btn primary" type="submit" id="lgBtn">Sign in</button>
        ${info.public_read ? '<button class="btn" type="button" id="lgGuest">Continue without signing in</button>' : ''}
      </form>`;
    A.$('#lgUser').focus();
    A.$('#loginForm').onsubmit = async e => {
      e.preventDefault();
      const btn = A.$('#lgBtn'); btn.disabled = true; btn.textContent = 'Signing in…'; A.$('#lgErr').textContent = '';
      try {
        await A.api('api/auth/login', { method: 'POST', body: { username: A.$('#lgUser').value.trim(), password: A.$('#lgPw').value } });
        box.hidden = true; document.body.classList.remove('signed-out');
        await start();
      } catch (err) { A.$('#lgErr').textContent = err.message; A.$('#lgPw').select(); }
      finally { btn.disabled = false; btn.textContent = 'Sign in'; }
    };
    const g = A.$('#lgGuest'); if (g) g.onclick = async () => { box.hidden = true; document.body.classList.remove('signed-out'); await start(); };
  }
  A.onSignedOut = () => { if (!A.state.static) showLogin({ expired: true }); };

  // ---------------------------------------------------------------- account panel
  function accountButton() {
    const u = A.state.ds.user, el = A.$('#account');
    if (A.state.static) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = u
      ? `<span class="avatar" aria-hidden="true">${A.esc((u.name || u.username).slice(0, 1).toUpperCase())}</span><span class="who"><b>${A.esc(u.name || u.username)}</b><small>${u.role === 'admin' ? 'Admin, can edit' : 'Viewer, read only'}</small></span>`
      : '<span class="who"><b>Sign in</b><small>Viewing as guest</small></span>';
    el.onclick = () => u ? openAccount() : showLogin({ public_read: true });
    A.$('#navUsers').hidden = !A.state.ds.can_write;
  }

  function openAccount() {
    const u = A.state.ds.user;
    A.closeDrawer();
    const scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.onclick = A.closeDrawer;
    const dr = document.createElement('aside'); dr.className = 'drawer'; dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-label', 'Your account');
    dr.innerHTML = `<header><div><h2>${A.esc(u.name || u.username)}</h2><p class="sub">${A.esc(u.username)}</p></div><button class="icon-btn" type="button" aria-label="Close">✕</button></header>
      <div class="body">
        <div class="verdict ${u.role === 'admin' ? 'targeted' : ''}"><div><b>${u.role === 'admin' ? 'Admin: read and write' : 'Viewer: read only'}</b><span class="small">${u.role === 'admin' ? 'You can view everything, upload or replace city workbooks, reload data and manage accounts.' : 'You can view every page, chart and download. Ask an admin if you need to change data.'}</span></div></div>
        <h3 class="sec">Change password</h3>
        <form id="pwForm" class="stack" style="gap:8px;margin-top:8px">
          <label class="field" style="flex-direction:column;align-items:stretch" for="pwCur">Current password<input id="pwCur" type="password" autocomplete="current-password" required></label>
          <label class="field" style="flex-direction:column;align-items:stretch" for="pwNew">New password<input id="pwNew" type="password" autocomplete="new-password" minlength="8" required></label>
          <div class="form-row" style="margin:0"><button class="btn primary" type="submit">Change password</button></div><div id="pwOut"></div>
        </form>
        <div class="form-row sec"><button class="btn" type="button" id="signOut">Sign out</button></div>
      </div>`;
    document.body.append(scrim, dr);
    requestAnimationFrame(() => dr.classList.add('open'));
    dr.querySelector('header button').onclick = A.closeDrawer;
    dr.querySelector('header button').focus();
    A.drawerKey = e => { if (e.key === 'Escape') A.closeDrawer(); };
    document.addEventListener('keydown', A.drawerKey);
    A.$('#pwForm').onsubmit = async e => {
      e.preventDefault();
      try { await A.api('api/auth/password', { method: 'POST', body: { current_password: A.$('#pwCur').value, new_password: A.$('#pwNew').value } }); A.$('#pwOut').innerHTML = '<div class="result ok">Password changed. Other devices have been signed out.</div>'; A.$('#pwForm').reset(); }
      catch (err) { A.$('#pwOut').innerHTML = `<div class="result err">${A.esc(err.message)}</div>`; }
    };
    A.$('#signOut').onclick = async () => { try { await A.api('api/auth/logout', { method: 'POST' }); } catch (e) {} A.closeDrawer(); const me = await A.api('api/auth/me'); showLogin(me); };
  }

  // ---------------------------------------------------------------- shell
  function rail() {
    const d = A.state.ds, cur = route();
    A.$('#cityList').innerHTML = d.cities.map(c => {
      const x = d.city[c];
      return `<a class="city-link" href="#/city/${encodeURIComponent(c)}" ${cur.view === 'city' && decodeURIComponent(cur.arg || '').toLowerCase() === c.toLowerCase() ? 'aria-current="page"' : ''}>
        <span class="rk">${x.rank}</span>${A.glyph(c, 34)}<span class="nm">${A.esc(c)}<small>${A.esc(x.state)}</small></span><span class="sc">${A.round(x.overall)}</span></a>`;
    }).join('');
    A.$('#railFoot').innerHTML = A.state.static
      ? 'Static preview. Run the backend to edit data.'
      : `${d.meta.files.length} workbooks in <code style="background:#ffffff14;color:inherit">data/cities</code><br><a href="#/data">${d.can_write ? 'Update data' : 'Data sources'}</a>`;
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
    if (!A.state.ds) return;
    const { view, arg } = route();
    A.closeDrawer?.();
    A.disposeCharts();
    let name = A.views[view] ? view : 'overview';
    if (name === 'users' && !A.state.ds.can_write) name = 'overview';
    A.$$('#views a').forEach(a => { if (a.dataset.v === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const arg2 = arg ? decodeURIComponent(arg) : undefined;
    try { A.views[name]({ city: arg2, id: arg2 }); }
    catch (e) { console.error(e); A.$('#view').innerHTML = `<div class="empty">This view could not be drawn: ${A.esc(e.message)}</div>`; }
    rail(); accountButton();
    document.title = `${name === 'city' && arg2 ? arg2 : name[0].toUpperCase() + name.slice(1)} | Urban Atlas`;
  }

  A.refresh = async (rerender = true) => {
    const prev = A.state.lastLoaded;
    setData(await fetchDashboard());
    sync();
    if (rerender) { const y = scrollY; render(); scrollTo(0, y); }
    return prev !== A.state.lastLoaded;
  };

  async function poll() {
    if (A.state.static || document.body.classList.contains('signed-out')) return;
    try {
      const j = await (await fetch('api/health', { cache: 'no-store' })).json();
      if (j.loaded_at !== A.state.lastLoaded) {
        const before = A.state.ds.history[0]?.ts;
        await A.refresh(true);
        const fresh = A.state.ds.history.filter(e => e.type === 'value' && (!before || e.ts > before));
        const cities = [...new Set(fresh.map(e => e.city))];
        A.toast(fresh.length ? `Data updated: ${fresh.length} value${fresh.length > 1 ? 's' : ''} changed in ${cities.join(', ')}.` : 'Data reloaded.');
      } else sync();
    } catch (e) { sync('err'); }
  }

  async function start() {
    try { setData(await fetchDashboard()); }
    catch (e) {
      if (/sign in/i.test(e.message)) return; // A.api already showed the sign-in screen
      A.$('#view').innerHTML = `<div class="empty">Could not load data: ${A.esc(e.message)}. Is the backend running?</div>`; sync('err'); return;
    }
    sync(); render();
    clearInterval(pollTimer);
    if (!A.state.static) pollTimer = setInterval(poll, POLL_MS);
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
    if (A.state.static) return start();
    let me;
    try { me = await A.api('api/auth/me'); }
    catch (e) { A.$('#view').innerHTML = `<div class="empty">Could not reach the server: ${A.esc(e.message)}.</div>`; sync('err'); return; }
    if (!me.user && !me.public_read) return showLogin(me);
    start();
  })();
})(window.A);
