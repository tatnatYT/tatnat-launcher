// Eclipse UI 2: the interactive half of ui2.css.
//  - Ctrl+K (or the search box in the title bar): a command palette for pages, versions, loaders and actions.
//  - Cards light up under the mouse (a soft spotlight that follows the pointer).
//  - Buttons ripple where they're clicked.
//  - The Play page greets the signed-in player with their head.
(() => {
  const $id = id => document.getElementById(id);

  // ---------- spotlight: --mx / --my on the card under the pointer ----------
  const LIT = '.home-tile, .setting, .pack-card, .mod-card, .account-row, .power-card, .boost-row, .plus-cape, .cape-card, #tab-play .dock, .modal-card';
  let lit = null;
  document.addEventListener('pointermove', e => {
    const el = e.target.closest?.(LIT);
    if (lit && lit !== el) lit.classList.remove('lit');
    lit = el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
    el.classList.add('lit');
  }, { passive: true });

  // ---------- ripples ----------
  const RIPPLE = '.ghost-btn, .play-btn, .install-btn, .segmented button, .nav-btn, .home-tile, .chips button, .cmdk-item';
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest?.(RIPPLE);
    if (!el || el.disabled) return;
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    el.classList.add('has-ripple');
    el.append(dot);
    dot.addEventListener('animationend', () => dot.remove());
  });

  // ---------- greeting with the player's head on the Play page ----------
  const hero = document.querySelector('#tab-play .hero-text');
  const heroHead = document.createElement('div');
  heroHead.className = 'head hero-head';
  const heroRow = document.createElement('div');
  heroRow.className = 'hero-row';
  if (hero) { hero.before(heroRow); heroRow.append(heroHead, hero); }
  const greet = document.createElement('div');
  greet.className = 'hero-greet';
  hero?.prepend(greet);
  function paintHero() {
    const acc = typeof activeAccount === 'function' ? activeAccount() : null;
    const h = new Date().getHours();
    const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    greet.textContent = acc ? `${part}, ${acc.name}` : `${part}`;
    heroHead.hidden = !acc;
    if (acc && typeof paintHead === 'function') paintHead(heroHead, acc);
  }
  if (typeof renderAccounts === 'function') {
    const orig = renderAccounts;
    window.renderAccounts = function (...a) { const r = orig.apply(this, a); paintHero(); return r; };
  }
  paintHero();
  setInterval(paintHero, 10 * 60 * 1000);

  // ---------- command palette ----------
  const tb = document.querySelector('.titlebar');
  const open = document.createElement('button');
  open.className = 'tb-search';
  open.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><span>Search pages, versions, actions…</span><kbd>Ctrl K</kbd>';
  tb?.append(open);

  const wrap = document.createElement('div');
  wrap.className = 'cmdk';
  wrap.hidden = true;
  wrap.innerHTML = '<div class="cmdk-card"><div class="cmdk-input"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input placeholder="Type a page, a version like 1.8.9, or an action…" spellcheck="false" autocomplete="off"><kbd>Esc</kbd></div><div class="cmdk-list"></div><div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>';
  document.body.append(wrap);
  const input = wrap.querySelector('input');
  const list = wrap.querySelector('.cmdk-list');
  let items = [], sel = 0;

  const ICON = {
    page: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4"/>',
    version: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    loader: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/>',
    action: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  };
  function commands() {
    const out = [];
    document.querySelectorAll('.nav-btn[data-tab]').forEach(b => {
      const name = b.querySelector('.nav-text')?.textContent || b.dataset.tab;
      out.push({ kind: 'page', label: name, hint: 'Go to page', run: () => showTab(b.dataset.tab) });
    });
    out.push({ kind: 'action', label: 'Play', hint: 'Start the selected version', run: () => { showTab('play'); $id('play')?.click(); } });
    out.push({ kind: 'action', label: 'Next background', hint: 'Play page art', run: () => { showTab('play'); $id('bgNext')?.click(); } });
    out.push({ kind: 'action', label: 'Add an account', hint: 'Sign in with Microsoft', run: () => showTab('accounts') });
    out.push({ kind: 'action', label: 'Search mods', hint: 'Modrinth', run: () => { showTab('mods'); setTimeout(() => $id('modSearch')?.focus(), 60); } });
    for (const [id, name] of [['vanilla', 'Vanilla'], ['fabric', 'Fabric'], ['forge', 'Forge'], ['neoforge', 'NeoForge'], ['boost', 'FPS Boost']]) {
      out.push({ kind: 'loader', label: `Use ${name}`, hint: 'Loader', run: () => { showTab('play'); document.querySelector(`#loader [data-loader="${id}"]`)?.click(); } });
    }
    const vd = typeof versionData !== 'undefined' ? versionData : { versions: [], latest: {} };
    for (const v of vd.versions || []) {
      const tag = v.id === vd.latest.release ? 'Latest release' : v.id === vd.latest.snapshot ? 'Latest snapshot' : (TYPE_LABEL?.[v.type] || v.type);
      out.push({ kind: 'version', label: `Minecraft ${v.id}`, hint: tag, id: v.id, type: v.type, run: () => pickVersion(v) });
    }
    return out;
  }
  function pickVersion(v) {
    showTab('play');
    if (v.type && v.type !== 'custom' && !enabledTypes().has(v.type)) {
      document.querySelector(`#typeChips [data-type="${v.type}"]`)?.click();
    }
    const sel = $id('version');
    sel.value = v.id;
    sel.dispatchEvent(new Event('change'));
    updateHero();
  }
  function score(c, q) {
    if (!q) return c.kind === 'version' ? (c.hint.startsWith('Latest') ? 1 : -1) : 2;
    const l = c.label.toLowerCase();
    if (c.id && c.id.toLowerCase() === q) return 10;
    if (l === q) return 9;
    if (l.startsWith(q) || (c.id && c.id.startsWith(q))) return 6 + (c.kind === 'page' ? 1 : 0);
    if (l.includes(q)) return 4;
    // letters in order ("tp" finds Texture Packs)
    let i = 0;
    for (const ch of l) if (ch === q[i]) i++;
    return i === q.length ? 1 : -1;
  }
  function render() {
    const q = input.value.trim().toLowerCase();
    items = commands().map(c => [score(c, q), c]).filter(([s]) => s >= 0)
      .sort((a, b) => b[0] - a[0]).slice(0, 40).map(([, c]) => c);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map((c, i) => {
      const b = document.createElement('button');
      b.className = 'cmdk-item' + (i === sel ? ' on' : '');
      b.innerHTML = `<svg viewBox="0 0 24 24">${ICON[c.kind]}</svg><strong></strong><span></span>`;
      b.querySelector('strong').textContent = c.label;
      b.querySelector('span').textContent = c.hint;
      b.addEventListener('click', () => choose(i));
      b.addEventListener('pointermove', () => { if (sel !== i) { sel = i; mark(); } });
      return b;
    }));
    if (!items.length) list.innerHTML = '<div class="cmdk-empty">Nothing found</div>';
  }
  function mark() {
    list.querySelectorAll('.cmdk-item').forEach((b, i) => b.classList.toggle('on', i === sel));
    list.querySelectorAll('.cmdk-item')[sel]?.scrollIntoView({ block: 'nearest' });
  }
  function choose(i) {
    const c = items[i];
    close();
    c?.run();
  }
  function show() {
    wrap.hidden = false;
    input.value = '';
    sel = 0;
    render();
    requestAnimationFrame(() => input.focus());
  }
  function close() { wrap.hidden = true; }
  open.addEventListener('click', show);
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(); });
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, items.length); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(1, items.length); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); wrap.hidden ? show() : close(); }
  });
})();
