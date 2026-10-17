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

  // ---------- even cooler ----------
  // Settings > Background effects > Off is the switch for these (not Windows' animation setting: the launcher is meant to move).
  const calm = () => document.documentElement.dataset.bgfx === 'off';
  const main = document.querySelector('main');

  // A soft glow that follows the mouse over the page, and the background art leaning the other way (parallax).
  const glow = document.createElement('div');
  glow.className = 'cursor-glow';
  (document.getElementById("bgSparkles") || main.firstChild).after(glow);
  const stage = $id('bgStage'), sparkles = $id('bgSparkles');
  let px = 0, py = 0, tx = 0, ty = 0, gx = -999, gy = -999, raf = 0;
  function frame() {
    raf = 0;
    px += (tx - px) * .08; py += (ty - py) * .08;
    if (!calm()) {
      stage.style.transform = `translate3d(${px * -14}px, ${py * -10}px, 0) scale(1.03)`;
      sparkles.style.transform = `translate3d(${px * -26}px, ${py * -18}px, 0)`;
    } else {
      stage.style.transform = sparkles.style.transform = '';
    }
    glow.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
    if (Math.abs(tx - px) > .002 || Math.abs(ty - py) > .002) raf = requestAnimationFrame(frame);
  }
  main.addEventListener('pointermove', e => {
    const r = main.getBoundingClientRect();
    tx = (e.clientX - r.left) / r.width - .5;
    ty = (e.clientY - r.top) / r.height - .5;
    gx = e.clientX - r.left; gy = e.clientY - r.top;
    glow.classList.add('on');
    if (!raf) raf = requestAnimationFrame(frame);
  }, { passive: true });
  main.addEventListener('pointerleave', () => glow.classList.remove('on'));

  // Cards tilt towards the mouse in 3D.
  const TILT = '.home-tile, .plus-cape:not(.locked), .pack-card';
  let tilted = null;
  document.addEventListener('pointermove', e => {
    const el = e.target.closest?.(TILT);
    if (tilted && tilted !== el) { tilted.style.removeProperty('--rx'); tilted.style.removeProperty('--ry'); }
    tilted = el;
    if (!el || calm()) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - .5) * -10}deg`);
    el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - .5) * 12}deg`);
  }, { passive: true });

  // The big Play title "decodes" into the new name whenever the version changes.
  const title = $id('heroVersion');
  const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&*+=<>/';
  // Observer callbacks run later, so our own frames are recognised by their text.
  let mine = '', target = title?.textContent || '';
  function scramble(to) {
    if (calm() || title.textContent === to) { title.textContent = to; return; }
    const start = performance.now(), dur = 560;
    const step = now => {
      if (target !== to) return; // a newer change took over
      const t = Math.min(1, (now - start) / dur);
      let out = '';
      for (let i = 0; i < to.length; i++) {
        const settle = (i / to.length) * .65 + .35;
        out += t >= settle || to[i] === ' ' ? to[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      mine = out;
      title.textContent = out;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  if (title) new MutationObserver(() => {
    if (title.textContent === mine || title.textContent === target) return;
    const next = title.textContent;
    mine = target;
    title.textContent = target;
    target = next;
    scramble(next);
  }).observe(title, { childList: true, characterData: true, subtree: true });

  // PLAY: a burst of light and sparks when a game starts, and the download progress fills the button.
  const play = $id('play');
  play?.addEventListener('pointerdown', () => {
    if (play.disabled || play.classList.contains('running') || calm()) return;
    if (typeof activeAccount === 'function' && !activeAccount()) return;
    const r = play.getBoundingClientRect();
    const burst = document.createElement('div');
    burst.className = 'launch-burst';
    burst.style.left = `${r.left + r.width / 2}px`;
    burst.style.top = `${r.top + r.height / 2}px`;
    burst.innerHTML = '<i class="ring"></i><i class="ring r2"></i>' + Array.from({ length: 18 }, (_, i) => {
      const a = (i / 18) * Math.PI * 2 + Math.random() * .3, d = 70 + Math.random() * 90;
      return `<b style="--x:${(Math.cos(a) * d).toFixed(1)}px;--y:${(Math.sin(a) * d).toFixed(1)}px;--d:${(.5 + Math.random() * .35).toFixed(2)}s"></b>`;
    }).join('');
    document.body.append(burst);
    setTimeout(() => burst.remove(), 1200);
  });
  // ---------- even cooler, part 3 ----------
  // An eclipse corona turning around the player's head.
  const avatar = document.createElement('div');
  avatar.className = 'hero-avatar';
  heroHead.before(avatar);
  avatar.append(Object.assign(document.createElement('i'), { className: 'corona' }), heroHead);
  new MutationObserver(() => { avatar.hidden = heroHead.hidden; }).observe(heroHead, { attributes: true, attributeFilter: ['hidden'] });
  avatar.hidden = heroHead.hidden;

  // The menu highlight stretches to the new item, then lets go of the old one.
  if (typeof moveIndicator === 'function') {
    const plain = moveIndicator;
    let lastY = null;
    window.moveIndicator = function () {
      const active = document.querySelector('.nav-btn.active');
      const ind = $id('navIndicator');
      if (!active || lastY === null || calm()) { plain(); lastY = active ? active.offsetTop : null; return; }
      const y = active.offsetTop, h = active.offsetHeight;
      if (y === lastY) { plain(); return; }
      const top = Math.min(lastY, y), bottom = Math.max(lastY, y) + h;
      ind.style.transform = `translateY(${top}px)`;
      ind.style.height = `${bottom - top}px`;
      lastY = y;
      clearTimeout(ind._t);
      ind._t = setTimeout(() => { ind.style.transform = `translateY(${y}px)`; ind.style.height = `${h}px`; }, 150);
    };
    requestAnimationFrame(() => { lastY = document.querySelector('.nav-btn.active')?.offsetTop ?? null; });
  }

  // A sweep of light across the page when you switch pages, and a few sparks from the menu item.
  if (typeof showTab === 'function') {
    const plainShow = showTab;
    let current = document.querySelector('.tab.active')?.id;
    window.showTab = function (name) {
      const r = plainShow(name);
      if (`tab-${name}` !== current && !calm()) {
        current = `tab-${name}`;
        const sweep = document.createElement('div');
        sweep.className = 'page-sweep';
        main.append(sweep);
        setTimeout(() => sweep.remove(), 800);
      }
      return r;
    };
  }
  document.addEventListener('click', e => {
    const b = e.target.closest?.('.nav-btn');
    if (!b || calm()) return;
    const r = b.querySelector('.nav-icon')?.getBoundingClientRect() || b.getBoundingClientRect();
    const s = document.createElement('div');
    s.className = 'launch-burst mini';
    s.style.left = `${r.left + r.width / 2}px`;
    s.style.top = `${r.top + r.height / 2}px`;
    s.innerHTML = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2, d = 16 + Math.random() * 14;
      return `<b style="--x:${(Math.cos(a) * d).toFixed(1)}px;--y:${(Math.sin(a) * d).toFixed(1)}px;--d:${(.35 + Math.random() * .2).toFixed(2)}s"></b>`;
    }).join('');
    document.body.append(s);
    setTimeout(() => s.remove(), 700);
  });

  // Easter egg: the Konami code (up up down down left right left right B A) starts a meteor shower.
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let kpos = 0;
  document.addEventListener('keydown', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    kpos = k === KONAMI[kpos] ? kpos + 1 : (k === KONAMI[0] ? 1 : 0);
    if (kpos < KONAMI.length) return;
    kpos = 0;
    const box = document.createElement('div');
    box.className = 'meteor-shower';
    box.innerHTML = Array.from({ length: 46 }, () =>
      `<i style="left:${(Math.random() * 130).toFixed(1)}%;top:${(Math.random() * 50 - 20).toFixed(1)}%;--d:${(0.7 + Math.random() * 0.9).toFixed(2)}s;--w:${(0 + Math.random() * 3.2).toFixed(2)}s;--l:${(90 + Math.random() * 160) | 0}px"></i>`).join('');
    main.append(box);
    if (typeof toast === 'function') toast('Meteor shower!');
    setTimeout(() => box.remove(), 5000);
  });

  // ---------- the best we can do ----------

  // Startup: a WebGL eclipse. The moon slides over a bright sun, the corona flares out and a
  // "diamond ring" flashes, then the logo text shows. Falls back to the logo picture without WebGL.
  (function eclipseIntro() {
    const logo = document.querySelector('#splash .splash-logo');
    if (!logo || calm()) return;
    const cv = document.createElement('canvas');
    cv.className = 'splash-eclipse';
    const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) return;
    const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const FS = `precision highp float;uniform vec2 res;uniform float t;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
      void main(){
        vec2 uv=(gl_FragCoord.xy-.5*res)/res.y;
        float R=.17;
        float k=clamp(t/1.25,0.,1.);k=1.-pow(1.-k,3.);
        vec2 mc=mix(vec2(-.5,.2),vec2(0.),k);
        float r=length(uv),a=atan(uv.y,uv.x);
        float rays=fbm(vec2(a*2.5+sin(a)*.5,r*5.-t*.7))*.9+fbm(vec2(a*8.,t*.35))*.45;
        float fall=exp(-max(r-R,0.)*mix(16.,6.5,k));
        float corona=fall*(.25+rays)*mix(.25,1.5,k);
        vec3 col=vec3(.58,.44,1.)*corona+vec3(.85,.8,1.)*pow(fall,5.)*mix(.15,1.1,k);
        col+=vec3(1.,.97,1.)*smoothstep(R+.004,R-.004,r);
        float moon=smoothstep(R+.007,R-.001,length(uv-mc));
        col=mix(col,vec3(.03,.02,.05),moon);
        float fl=exp(-pow((t-1.2)*6.,2.));
        vec2 dp=vec2(-R*.62,R*.79);float d=length(uv-dp);
        col+=vec3(1.,.95,1.)*fl*(.025/(d+.012));
        col+=vec3(.85,.75,1.)*fl*.003/(abs(uv.y-dp.y)+.003)*exp(-abs(uv.x-dp.x)*5.);
        col*=smoothstep(0.,.25,t)*smoothstep(.5,.3,r);
        float al=clamp(max(max(col.r,col.g),col.b),0.,1.);
        gl_FragColor=vec4(min(col,vec3(1.)),al);
      }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'res'), uT = gl.getUniformLocation(prog, 't');
    const size = 300, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.height = size * dpr;
    logo.replaceWith(cv);
    const t0 = performance.now();
    const draw = now => {
      if (!cv.isConnected) { gl.getExtension('WEBGL_lose_context')?.loseContext(); return; }
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform2f(uRes, cv.width, cv.height);
      gl.uniform1f(uT, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    document.getElementById('splash')?.classList.add('has-eclipse');
  })();

  // Interface sounds: tiny synthesised clicks and a launch chime (no sound files). Settings > Interface sounds.
  const sound = (() => {
    let ctx = null, on = true;
    try { on = localStorage.getItem('ui-sounds') !== '0'; } catch { /* storage off */ }
    const box = $id('uiSounds');
    if (box) {
      box.checked = on;
      box.addEventListener('change', () => {
        on = box.checked;
        try { localStorage.setItem('ui-sounds', on ? '1' : '0'); } catch { /* storage off */ }
        if (on) play('tick');
      });
    }
    function tone(f0, f1, dur, vol, type = 'sine', delay = 0) {
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + .006);
      g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + .02);
    }
    function play(kind) {
      if (!on) return;
      try {
        ctx ||= new AudioContext();
        if (kind === 'tick') tone(2100, 1300, .045, .035);
        else if (kind === 'soft') tone(900, 700, .06, .03, 'triangle');
        else if (kind === 'open') { tone(400, 900, .16, .03, 'triangle'); tone(1200, 1800, .12, .015, 'sine', .03); }
        else if (kind === 'launch') {
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, f * 1.002, .5, .045, 'sine', i * .07));
          tone(2093, 2093, .9, .015, 'triangle', .28);
        }
      } catch { /* no audio device */ }
    }
    return play;
  })();
  document.addEventListener('click', e => {
    const el = e.target.closest?.('button, .switch, select');
    if (!el || el.disabled) return;
    if (el.id === 'play') return; // has its own chime
    sound(el.closest('.nav-btn, .segmented, .chips') ? 'tick' : 'soft');
  }, true);
  open.addEventListener('click', () => sound('open'));
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && wrap.hidden === false) sound('open'); });

  // Magnetic PLAY: the button leans towards the mouse when it comes near.
  if (play) {
    main.addEventListener('pointermove', e => {
      if (calm() || play.offsetParent === null) return;
      const r = play.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist > 170) { play.style.translate = ''; return; }
      const pull = (1 - dist / 170) * .22;
      play.style.translate = `${(dx * pull).toFixed(1)}px ${(dy * pull * .7).toFixed(1)}px`;
    }, { passive: true });
    main.addEventListener('pointerleave', () => { play.style.translate = ''; });
    play.addEventListener('click', () => {
      if (play.classList.contains('running') || play.disabled) return;
      if (typeof activeAccount === 'function' && activeAccount()) sound('launch');
    });
  }

  // Sparkle trail behind the mouse on the Play page.
  let lastSpark = 0;
  main.addEventListener('pointermove', e => {
    if (calm() || !$id('tab-play').classList.contains('active')) return;
    if (e.target.closest('.flappy, .dock, input, select')) return;
    const now = performance.now();
    if (now - lastSpark < 38) return;
    lastSpark = now;
    const r = main.getBoundingClientRect();
    const s = document.createElement('i');
    s.className = 'trail';
    s.style.left = `${e.clientX - r.left}px`;
    s.style.top = `${e.clientY - r.top}px`;
    s.style.setProperty('--x', `${(Math.random() - .5) * 30}px`);
    s.style.setProperty('--y', `${12 + Math.random() * 26}px`);
    s.style.setProperty('--s', (.5 + Math.random() * .9).toFixed(2));
    main.append(s);
    setTimeout(() => s.remove(), 800);
  }, { passive: true });

  // "In game" with a live timer in the Play page pill while a game runs.
  const heroText = document.querySelector('#tab-play .hero-text');
  let since = 0;
  function pill() {
    const running = document.body.dataset.game === 'running';
    if (running && !since) since = Date.now();
    if (!running) since = 0;
    if (!heroText) return;
    if (running) {
      const s = Math.floor((Date.now() - since) / 1000);
      const hms = (s >= 3600 ? `${Math.floor(s / 3600)}:` : '') + `${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      heroText.dataset.pill = `IN GAME · ${hms}`;
    } else heroText.dataset.pill = 'NOW PLAYING';
    heroText.classList.toggle('live', running);
  }
  pill();
  setInterval(pill, 1000);

  const fill = $id('progressFill');
  if (fill && play) new MutationObserver(() => play.style.setProperty('--p', fill.style.width || '0%'))
    .observe(fill, { attributes: true, attributeFilter: ['style'] });
})();
