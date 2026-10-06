// Skins tab: 3D preview (skinview3d), your skin library, Minecraft's default skins and capes.
// Picking anything only previews it; "Wear this skin" / "Equip cape" change the real account.
(() => {
  const $ = id => document.getElementById(id);
  const api = window.launcher;
  const toast = window.toast || (m => alert(m));

  let state = null;          // last skins:state result
  let viewer = null;
  let loaded = false;
  let busy = false;
  // What the big preview shows.
  let sel = null;            // { kind: 'current'|'library'|'default', id, name, texture, variant }
  let capeSel = undefined;   // undefined = current cape, null = no cape, otherwise a cape id
  let back = 'cape';

  // ---------- 3D viewer ----------
  function ensureViewer() {
    if (viewer || !window.skinview3d) return;
    const canvas = $('skinCanvas');
    viewer = new skinview3d.SkinViewer({ canvas, width: 300, height: 400, enableControls: true });
    viewer.background = null;
    viewer.fov = 50;
    viewer.zoom = 0.6;
    viewer.autoRotate = true;
    viewer.autoRotateSpeed = 0.6;
    viewer.animation = new skinview3d.WalkingAnimation();
    viewer.animation.speed = 0.8;
    // Stop spinning once the player grabs the model.
    canvas.addEventListener('pointerdown', () => { viewer.autoRotate = false; });
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();
  }

  function resize() {
    if (!viewer) return;
    const box = $('skinCanvas').parentElement.getBoundingClientRect();
    viewer.setSize(Math.max(160, Math.floor(box.width)), Math.max(200, Math.floor(box.height)));
  }

  const ANIMS = {
    idle: () => new skinview3d.IdleAnimation(),
    walk: () => Object.assign(new skinview3d.WalkingAnimation(), { speed: 0.8 }),
    run: () => Object.assign(new skinview3d.RunningAnimation(), { speed: 0.7 }),
    fly: () => new skinview3d.FlyingAnimation(),
  };

  $('skinAnim').addEventListener('click', e => {
    const b = e.target.closest('button[data-anim]');
    if (!b || !viewer) return;
    for (const x of $('skinAnim').children) x.classList.toggle('on', x === b);
    viewer.animation = ANIMS[b.dataset.anim]();
    // Flying looks best with the elytra out.
    if (b.dataset.anim === 'fly' && back !== 'elytra') setBack('elytra');
  });

  function setBack(kind) {
    back = kind;
    for (const x of $('skinBack').children) x.classList.toggle('on', x.dataset.back === kind);
    showCape();
  }
  $('skinBack').addEventListener('click', e => {
    const b = e.target.closest('button[data-back]');
    if (b) setBack(b.dataset.back);
  });

  function capeTexture() {
    const capes = state?.profile?.capes || [];
    if (capeSel === null) return null;
    if (capeSel !== undefined) return capes.find(c => c.id === capeSel)?.texture || null;
    return capes.find(c => c.active)?.texture || null;
  }

  function showCape() {
    if (!viewer) return;
    const tex = capeTexture();
    if (tex) viewer.loadCape(tex, { backEquipment: back === 'elytra' ? 'elytra' : 'cape' });
    else viewer.resetCape();
  }

  async function showSkin() {
    if (!viewer || !sel) return;
    $('skinLoading').hidden = true;
    await viewer.loadSkin(sel.texture, { model: sel.variant === 'slim' ? 'slim' : 'default' });
    viewer.nameTag = sel.kind === 'current' ? state.profile?.name || null : null;
    $('skinPreviewName').textContent = sel.name;
    $('skinPreviewMeta').textContent = sel.kind === 'current' ? 'Wearing now' : sel.kind === 'default' ? 'Minecraft skin' : 'From your skins';
    for (const x of $('skinVariant').children) x.classList.toggle('on', x.dataset.variant === sel.variant);
    // Default skins come in fixed arm widths; your own uploads can be switched.
    $('skinVariant').classList.toggle('locked', sel.kind === 'current');
    updateWear();
    markSelected();
  }

  function isWearing() {
    const cur = state?.profile?.skin;
    return sel && cur && sel.texture === cur.texture && sel.variant === cur.variant;
  }

  function updateWear() {
    const ms = state?.account?.type === 'microsoft' && state?.profile;
    const btn = $('skinWear');
    btn.disabled = busy || !ms || !sel || sel.kind === 'current' || isWearing();
    btn.textContent = busy ? 'Saving…' : isWearing() ? 'Wearing this skin' : 'Wear this skin';
    const capes = state?.profile?.capes || [];
    const activeId = capes.find(c => c.active)?.id || null;
    $('capeEquip').disabled = busy || !ms || capeSel === undefined || capeSel === activeId;
    $('capeEquip').textContent = capeSel === null ? 'Hide cape' : 'Equip cape';
  }

  $('skinVariant').addEventListener('click', async e => {
    const b = e.target.closest('button[data-variant]');
    if (!b || !sel || sel.kind === 'current') return;
    const variant = b.dataset.variant;
    if (sel.kind === 'default') {
      const d = state.defaults.find(x => x.id === `default:${sel.name.toLowerCase()}:${variant}`);
      if (d) sel = { ...sel, id: d.id, texture: d.texture, variant };
    } else {
      sel = { ...sel, variant };
      await api.updateSkin(sel.id, { variant });
      const lib = state.library.find(x => x.id === sel.id);
      if (lib) lib.variant = variant;
    }
    showSkin();
  });

  // ---------- 2D thumbnails ----------
  // A front view of the skin (head, body, arms, legs + overlay layers) on a small canvas.
  function bodyThumb(texture, variant) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 32;
    c.className = 'skin-thumb';
    const img = new Image();
    img.onload = () => {
      const g = c.getContext('2d');
      const legacy = img.height === 32;
      const arm = variant === 'slim' ? 3 : 4;
      const parts = [
        // [sx, sy, w, h, dx, dy] base layer, then overlay layer
        [8, 8, 8, 8, 4, 0], [20, 20, 8, 12, 4, 8],
        [44, 20, arm, 12, 4 - arm, 8], legacy ? [44, 20, arm, 12, 12, 8] : [36, 52, arm, 12, 12, 8],
        [4, 20, 4, 12, 4, 20], legacy ? [4, 20, 4, 12, 8, 20] : [20, 52, 4, 12, 8, 20],
        [40, 8, 8, 8, 4, 0],
      ];
      if (!legacy) parts.push([20, 36, 8, 12, 4, 8], [44, 36, arm, 12, 4 - arm, 8], [52, 52, arm, 12, 12, 8], [4, 36, 4, 12, 4, 20], [4, 52, 4, 12, 8, 20]);
      for (const [sx, sy, w, h, dx, dy] of parts) g.drawImage(img, sx, sy, w, h, dx, dy, w, h);
    };
    img.src = texture;
    return c;
  }

  function capeThumb(texture) {
    const c = document.createElement('canvas');
    c.width = 10; c.height = 16;
    c.className = 'cape-thumb';
    if (!texture) return c;
    const img = new Image();
    img.onload = () => {
      // Cape textures are 64x32 or larger multiples; the outside face is at (1,1) 10x16.
      const k = img.width / 64;
      c.getContext('2d').drawImage(img, 1 * k, 1 * k, 10 * k, 16 * k, 0, 0, 10, 16);
    };
    img.src = texture;
    return c;
  }

  // ---------- lists ----------
  function tile({ thumb, label, sub, onClick, onRemove, data }) {
    const el = document.createElement('button');
    el.className = 'skin-tile';
    Object.assign(el.dataset, data);
    el.appendChild(thumb);
    const t = document.createElement('span');
    t.className = 'skin-tile-label';
    t.textContent = label;
    el.appendChild(t);
    if (sub) {
      const s = document.createElement('span');
      s.className = 'skin-tile-sub';
      s.textContent = sub;
      el.appendChild(s);
    }
    if (onRemove) {
      const x = document.createElement('span');
      x.className = 'skin-tile-remove';
      x.title = 'Remove from your skins';
      x.textContent = '×';
      x.addEventListener('click', ev => { ev.stopPropagation(); onRemove(); });
      el.appendChild(x);
    }
    el.addEventListener('click', onClick);
    return el;
  }

  function markSelected() {
    document.querySelectorAll('#tab-skins .skin-tile[data-skin]').forEach(t => t.classList.toggle('selected', !!sel && t.dataset.skin === (sel.kind === 'default' ? sel.name : sel.id)));
    document.querySelectorAll('#tab-skins .skin-tile[data-cape]').forEach(t => {
      const id = t.dataset.cape === 'none' ? null : t.dataset.cape;
      const active = (state?.profile?.capes || []).find(c => c.active)?.id || null;
      const shown = capeSel === undefined ? active : capeSel;
      t.classList.toggle('selected', id === shown);
      t.classList.toggle('wearing', id === active);
    });
  }

  function renderLists() {
    const lib = $('skinLibrary');
    lib.replaceChildren();
    const cur = state.profile?.skin;
    if (cur?.texture) {
      lib.appendChild(tile({
        thumb: bodyThumb(cur.texture, cur.variant), label: 'Wearing now', sub: cur.variant === 'slim' ? 'Slim' : 'Classic',
        data: { skin: 'current' },
        onClick: () => { sel = { kind: 'current', id: 'current', name: 'Your skin', texture: cur.texture, variant: cur.variant }; showSkin(); },
      }));
    }
    for (const s of state.library) {
      lib.appendChild(tile({
        thumb: bodyThumb(s.texture, s.variant), label: s.name, sub: s.variant === 'slim' ? 'Slim' : 'Classic',
        data: { skin: s.id },
        onClick: () => { sel = { kind: 'library', id: s.id, name: s.name, texture: s.texture, variant: s.variant }; showSkin(); },
        onRemove: async () => {
          await api.removeSkin(s.id);
          state.library = state.library.filter(x => x.id !== s.id);
          if (sel?.id === s.id) pickDefault();
          renderLists();
        },
      }));
    }
    $('skinLibraryEmpty').hidden = state.library.length > 0;

    const defs = $('skinDefaults');
    defs.replaceChildren();
    const seen = new Set();
    for (const d of state.defaults) {
      if (seen.has(d.name)) continue;
      seen.add(d.name);
      // Steve is classic by default, Alex slim; the others start classic.
      const prefer = d.name === 'Alex' ? 'slim' : 'classic';
      const pick = state.defaults.find(x => x.name === d.name && x.variant === prefer) || d;
      defs.appendChild(tile({
        thumb: bodyThumb(pick.texture, pick.variant), label: d.name, data: { skin: d.name },
        onClick: () => { sel = { kind: 'default', id: pick.id, name: d.name, texture: pick.texture, variant: pick.variant }; showSkin(); },
      }));
    }
    if (!state.defaults.length) {
      defs.innerHTML = `<p class="skin-empty">${state.defaultsError ? `Couldn't load Minecraft's skins: ${state.defaultsError}` : 'Loading…'}</p>`;
    }

    const capes = $('skinCapes');
    capes.replaceChildren();
    const owned = state.profile?.capes || [];
    if (owned.length) {
      capes.appendChild(tile({ thumb: capeThumb(null), label: 'No cape', data: { cape: 'none' }, onClick: () => { capeSel = null; showCape(); updateWear(); markSelected(); } }));
      for (const c of owned) {
        capes.appendChild(tile({
          thumb: capeThumb(c.texture), label: c.alias || 'Cape', sub: c.active ? 'Wearing' : '', data: { cape: c.id },
          onClick: () => { capeSel = c.id; if (back !== 'cape' && back !== 'elytra') setBack('cape'); showCape(); updateWear(); markSelected(); },
        }));
      }
    }
    $('skinCapesEmpty').hidden = owned.length > 0 || !state.profile;
    markSelected();
  }

  function pickDefault() {
    const cur = state.profile?.skin;
    if (cur?.texture) sel = { kind: 'current', id: 'current', name: 'Your skin', texture: cur.texture, variant: cur.variant };
    else if (state.library[0]) { const s = state.library[0]; sel = { kind: 'library', id: s.id, name: s.name, texture: s.texture, variant: s.variant }; }
    else if (state.defaults[0]) { const d = state.defaults[0]; sel = { kind: 'default', id: d.id, name: d.name, texture: d.texture, variant: d.variant }; }
  }

  function renderBanner() {
    const b = $('skinsBanner');
    const acc = state.account;
    let msg = '';
    if (!acc) msg = 'Add an account in Accounts first. You can still preview skins here.';
    else if (acc.type !== 'microsoft') msg = 'Offline accounts have no real skin. Sign in with Microsoft to wear a skin online; you can still preview them here.';
    else if (state.profileError) msg = `Couldn't load your Minecraft profile: ${state.profileError}`;
    b.textContent = msg;
    b.hidden = !msg;
    $('skinsWho').textContent = acc ? `${acc.name}${acc.type === 'microsoft' ? '' : ' (offline)'}` : '';
    $('skinSaveCurrent').hidden = !state.profile?.skin;
  }

  async function load() {
    ensureViewer();
    $('skinLoading').hidden = false;
    try {
      state = await api.skinsState();
    } catch (err) {
      toast(err.message);
      return;
    }
    loaded = true;
    capeSel = undefined;
    renderBanner();
    if (!sel || (sel.kind === 'current' && state.profile?.skin)) pickDefault();
    renderLists();
    await showSkin();
    showCape();
  }

  // ---------- actions ----------
  $('skinWear').addEventListener('click', async () => {
    if (!sel || busy) return;
    busy = true;
    updateWear();
    try {
      const opts = sel.kind === 'default' ? { defaultId: sel.id, variant: sel.variant } : { libraryId: sel.id, variant: sel.variant };
      state.profile = await api.applySkin(opts);
      toast(`You're now wearing ${sel.name}. It shows in game after you rejoin a world or server.`);
      sel = { ...sel };
      renderLists();
    } catch (err) {
      toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      busy = false;
      updateWear();
    }
  });

  $('capeEquip').addEventListener('click', async () => {
    if (busy || capeSel === undefined) return;
    busy = true;
    updateWear();
    try {
      state.profile = await api.setCape(capeSel);
      toast(capeSel ? 'Cape equipped.' : 'Cape hidden.');
      capeSel = undefined;
      renderLists();
      showCape();
    } catch (err) {
      toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      busy = false;
      updateWear();
    }
  });

  async function importFiles(files) {
    if (!files?.length) return;
    // Guess slim arms from the file name (e.g. "alex", "slim"); it can be switched afterwards.
    const variant = files.some(f => /slim|alex/i.test(f)) ? 'slim' : 'classic';
    const { added, errors } = await api.importSkins({ files, variant });
    if (!state) await load();
    for (const a of added) if (!state.library.some(x => x.id === a.id)) state.library.unshift(a);
    if (added.length) {
      const a = added[0];
      sel = { kind: 'library', id: a.id, name: a.name, texture: a.texture, variant: a.variant };
      renderLists();
      showSkin();
    }
    if (errors.length) toast(errors.join(' · '));
    else if (added.length) toast(added.length === 1 ? `Added ${added[0].name}. Press "Wear this skin" to use it.` : `Added ${added.length} skins.`);
  }
  window.importSkinFiles = importFiles;

  $('skinUpload').addEventListener('click', async () => importFiles(await api.pickSkinFiles()));

  $('skinSaveCurrent').addEventListener('click', async () => {
    try {
      const s = await api.saveCurrentSkin();
      if (!state.library.some(x => x.id === s.id)) state.library.unshift(s);
      renderLists();
      toast('Saved to your skins.');
    } catch (err) {
      toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  });

  window.onSkinsTab = () => {
    if (!loaded) load();
    else resize();
  };
  // Account switches change whose skin we show.
  api.onAccounts?.(() => { if (loaded) load(); });
})();
