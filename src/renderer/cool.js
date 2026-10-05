// The fun layer: 3D Minecraft heads, the startup splash, the yellow title splash text,
// the play-button block burst and staggered list animations. Loaded before renderer.js.
(() => {
  const TATNAT_SKIN = '../../assets/tatnat-skin.png';

  // ---------- 3D heads (built from a 64x64 skin: head + hat layer) ----------
  const FACES = {
    front: [8, 8], back: [24, 8], right: [0, 8], left: [16, 8], top: [8, 0], bottom: [16, 0],
  };
  const HAT = Object.fromEntries(Object.entries(FACES).map(([k, [x, y]]) => [k, [x + 32, y]]));

  function layer(faces, cls) {
    const cube = document.createElement('div');
    cube.className = `cube ${cls}`;
    for (const [name, [x, y]] of Object.entries(faces)) {
      const f = document.createElement('div');
      f.className = `face ${name}`;
      f.style.setProperty('--fx', x);
      f.style.setProperty('--fy', y);
      cube.append(f);
    }
    return cube;
  }

  // mode: 'spin' (turns forever), 'sway' (gentle side to side) or 'look' (follows the mouse)
  function head3d(size, { skin, mode = 'sway' } = {}) {
    const root = document.createElement('div');
    root.className = `head3d ${mode}`;
    root.style.setProperty('--size', `${size}px`);
    if (skin) root.style.setProperty('--skin', `url("${skin}")`);
    const rig = document.createElement('div');
    rig.className = 'rig';
    rig.append(layer(FACES, 'base'), layer(HAT, 'hat'));
    root.append(rig);
    return root;
  }

  // Heads in 'look' mode turn towards the mouse.
  const lookers = new Set();
  window.addEventListener('mousemove', e => {
    for (const el of lookers) {
      if (!el.isConnected) { lookers.delete(el); continue; }
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;
      const dy = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
      el.querySelector('.rig').style.transform = `rotateX(${(-dy * 40).toFixed(1)}deg) rotateY(${(dx * 70).toFixed(1)}deg)`;
    }
  });

  function replaceWithHead(selector, size, mode) {
    document.querySelectorAll(selector).forEach(img => {
      const head = head3d(size, { skin: TATNAT_SKIN, mode });
      head.classList.add(...[...img.classList].filter(c => c !== 'logo'));
      img.replaceWith(head);
      if (mode === 'look') lookers.add(head);
    });
  }

  // tatnat's head on the sign-in card and in Credits; the player's own head in the sidebar.
  replaceWithHead('.login-card img.logo', 84, 'look');
  replaceWithHead('img.creator-head', 112, 'look');
  const card = document.getElementById('cardHead');
  card.classList.add('head3d-host');
  card.append(head3d(30, { mode: 'sway' })); // skin comes from paintHead() setting --skin on the host

  // ---------- startup splash ----------
  const splash = document.createElement('div');
  splash.id = 'splash';
  const inner = document.createElement('div');
  inner.className = 'splash-inner';
  const title = document.createElement('div');
  title.className = 'splash-title';
  title.innerHTML = 'tatnat<span>LAUNCHER</span>';
  const bar = document.createElement('div');
  bar.className = 'splash-bar';
  bar.append(document.createElement('i'));
  inner.append(head3d(110, { skin: TATNAT_SKIN, mode: 'spin' }), title, bar);
  splash.append(inner);
  document.body.append(splash);
  const shownAt = performance.now();
  window.hideSplash = () => {
    const wait = Math.max(0, 1300 - (performance.now() - shownAt));
    setTimeout(() => { splash.classList.add('gone'); setTimeout(() => splash.remove(), 600); }, wait);
  };
  setTimeout(() => window.hideSplash(), 6000); // never get stuck behind it

  // ---------- Minecraft-style yellow splash text by the title ----------
  const SPLASHES = [
    'Made by tatnat!', 'Subscribe!', '100x cooler!', 'Now with FPS Boost!', 'Fabric powered!',
    'Also try Minecraft!', 'Modpacks!', 'Texture packs!', 'Sodium inside!', 'Blocky!',
    'Pixel perfect!', 'youtube.com/@tatnatmc', 'Every version!', 'Not affiliated with Mojang!', 'Hi!',
  ];
  const hero = document.querySelector('.hero-text');
  const splashText = document.createElement('div');
  splashText.className = 'mc-splash';
  splashText.textContent = SPLASHES[(Math.random() * SPLASHES.length) | 0];
  splashText.title = 'Click for another one';
  splashText.addEventListener('click', () => {
    let next;
    do next = SPLASHES[(Math.random() * SPLASHES.length) | 0]; while (next === splashText.textContent);
    splashText.textContent = next;
  });
  // Sits at the end of the title like the real one; wraps the h1 because updateHero() rewrites its text.
  const h1 = document.getElementById('heroVersion');
  const wrap = document.createElement('div');
  wrap.className = 'title-wrap';
  h1.replaceWith(wrap);
  wrap.append(h1, splashText);

  // ---------- PLAY: block burst ----------
  const COLORS = ['#6cbf3f', '#86603a', '#8a8a8a', '#4fe3e0', '#f0b429', '#4fa52c'];
  document.getElementById('play').addEventListener('click', e => {
    const btn = e.currentTarget;
    if (btn.disabled || btn.classList.contains('running')) return;
    const r = btn.getBoundingClientRect();
    for (let i = 0; i < 18; i++) {
      const p = document.createElement('i');
      p.className = 'burst';
      const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.4;
      const dist = 60 + Math.random() * 70;
      p.style.left = `${r.left + r.width / 2}px`;
      p.style.top = `${r.top + r.height / 2}px`;
      p.style.background = COLORS[i % COLORS.length];
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist - 30}px`);
      p.style.setProperty('--rot', `${(Math.random() * 360) | 0}deg`);
      document.body.append(p);
      setTimeout(() => p.remove(), 800);
    }
  }, true);

  // ---------- staggered entrance for list items ----------
  const stagger = list => {
    [...list.children].forEach((child, i) => {
      if (child.dataset.in) return;
      child.dataset.in = '1';
      child.style.setProperty('--i', Math.min(i, 14));
      child.classList.add('enter');
    });
  };
  const watch = new MutationObserver(records => {
    for (const r of records) if (r.target.matches?.('.mod-list, .pack-grid, #accountList, .boost-pack')) stagger(r.target);
  });
  document.querySelectorAll('.mod-list, .pack-grid, #accountList, .boost-pack').forEach(list => watch.observe(list, { childList: true }));
})();
