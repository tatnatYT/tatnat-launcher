// Eclipse Plus page: buy / activate, the cape gallery (animated previews), and owner tools.
(() => {
  const api = window.launcher;
  const $ = id => document.getElementById(id);
  const capeImg = id => `../../assets/capes/${id}.gif`;
  let state = null, busy = false;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = err => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  // Messages show in a floating toast (the page scrolls, so a line at the top could be out of view),
  // and also next to the part of the page they're about.
  let toastTimer;
  function say(text, kind = '', where = 'plusMsg') {
    for (const id of ['plusMsg', 'plusOwnerMsg']) {
      const m = $(id);
      const here = id === where && !!text;
      m.hidden = !here;
      if (here) {
        m.textContent = text;
        m.className = `plus-msg ${kind}`;
      }
    }
    const t = $('plusToast');
    t.hidden = !text;
    t.textContent = text || '';
    t.className = `plus-toast ${kind}`;
    clearTimeout(toastTimer);
    if (text) toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }
  const notLive = "Eclipse Plus isn't live yet: wearing and giving capes works as soon as the Plus server is online.";

  function render() {
    const s = state;
    const session = s?.session;
    const plus = !!session?.plus;
    $('plusBuy').hidden = plus;
    $('plusOwned').hidden = !plus;
    $('plusKeyRow').hidden = plus || !s?.available || !s.checkout;
    $('plusBuy').disabled = !s?.available || !s.checkout;
    $('plusBuy').querySelector('span').textContent = !s?.available ? 'Coming soon' : s.checkout ? 'Get Plus' : 'Buying opens soon';
    $('plusWho').textContent = !s?.available ? 'Eclipse Plus is coming soon'
      : !s.account ? 'Add an account to use Eclipse Plus'
      : s.account.type !== 'microsoft' ? 'Eclipse Plus needs a Microsoft account (offline accounts have no cape)'
      : s.error ? s.error
      : plus ? `Pick a cape for ${session.name}` : 'Get Plus to wear these';
    const grid = $('plusCapes');
    grid.innerHTML = '';
    for (const c of s?.capes || []) {
      const card = document.createElement('button');
      card.className = 'plus-cape' + (c.solid ? ' solid' : '') + (session?.cape === c.id ? ' on' : '') + (plus ? '' : ' locked');
      card.dataset.cape = c.id;
      card.innerHTML = `<span class="plus-cape-art"><img src="${capeImg(c.id)}" alt="" loading="lazy"></span>
        <span class="plus-cape-name">${esc(c.name)}${c.solid ? '' : '<i>ANIMATED</i>'}</span>
        ${c.desc ? `<span class="plus-cape-desc">${esc(c.desc)}</span>` : ''}
        ${session?.cape === c.id ? '<span class="plus-cape-tag">WEARING</span>' : ''}`;
      card.addEventListener('mouseenter', () => { $('plusHeroCape').src = capeImg(c.id); });
      card.addEventListener('click', () => equip(c.id));
      grid.append(card);
    }
    if (plus) {
      const none = document.createElement('button');
      none.className = 'plus-cape none' + (session.cape === 'none' ? ' on' : '');
      none.innerHTML = '<span class="plus-cape-art"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/></svg></span><span class="plus-cape-name">No cape</span>';
      none.addEventListener('click', () => equip('none'));
      grid.append(none);
    }
    $('plusSoon').hidden = !!s?.available;
    $('plusOwner').hidden = !session?.owner;
    if (session?.owner) {
      const sel = $('plusGrantCape');
      if (!sel.options.length) sel.innerHTML = (s.capes || []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      loadUsers();
    }
  }

  async function load(refresh) {
    try {
      state = await api.plusState({ refresh });
    } catch (err) {
      state = { available: false, capes: [], error: clean(err) };
    }
    render();
  }
  window.onPlusTab = () => load(false);

  async function equip(cape) {
    if (busy) return;
    if (!state?.session?.plus) {
      say(state?.available ? (state.session ? 'Get Eclipse Plus to wear this cape.' : state.error || 'Sign in with a Microsoft account to wear capes.') : notLive, 'bad');
      return;
    }
    busy = true;
    try {
      const r = await api.plusEquip(cape);
      state.session.cape = r.cape;
      say(cape === 'none' ? 'Cape hidden.' : 'Cape changed. Other players see it within a few minutes.', 'ok');
      render();
    } catch (err) {
      say(clean(err), 'bad');
    } finally {
      busy = false;
    }
  }

  $('plusBuy').addEventListener('click', () => api.plusCheckout());
  $('plusActivate').addEventListener('click', async () => {
    const key = $('plusKey').value.trim();
    if (!key) { say('Paste the license key from your Eclipse Plus email first.', 'bad'); return; }
    $('plusActivate').disabled = true;
    say('Activating…');
    try {
      await api.plusActivate(key);
      $('plusKey').value = '';
      say('Welcome to Eclipse Plus! Pick a cape below.', 'ok');
      await load(true);
    } catch (err) {
      say(clean(err), 'bad');
    } finally {
      $('plusActivate').disabled = false;
    }
  });
  $('plusKey').addEventListener('keydown', e => { if (e.key === 'Enter') $('plusActivate').click(); });

  // ---------- owner tools ----------
  async function loadUsers() {
    const box = $('plusUsers');
    try {
      const { users } = await api.plusAdmin('list');
      box.innerHTML = users.length ? `<table><thead><tr><th>Player</th><th>Cape</th><th>How</th><th>Since</th></tr></thead><tbody>${
        users.map(u => `<tr><td>${esc(u.name || u.uuid)}</td><td>${esc(u.cape)}</td><td>${u.bought ? 'Bought' : `Given by ${esc(u.granted_by || '?')}`}</td><td>${new Date(u.since).toLocaleDateString()}</td></tr>`).join('')
      }</tbody></table>` : '<p class="skin-empty">Nobody has Eclipse Plus yet.</p>';
    } catch (err) {
      box.innerHTML = `<p class="skin-empty">${esc(clean(err))}</p>`;
    }
  }
  async function ownerAction(action) {
    const player = $('plusPlayer').value.trim();
    if (!state?.available) { say(notLive, 'bad', 'plusOwnerMsg'); return; }
    if (!player) { say('Type a Minecraft name or UUID first.', 'bad', 'plusOwnerMsg'); return; }
    say(action === 'grant' ? `Giving ${player} Eclipse Plus…` : `Taking Eclipse Plus away from ${player}…`, '', 'plusOwnerMsg');
    try {
      const r = await api.plusAdmin(action, action === 'grant' ? { player, cape: $('plusGrantCape').value } : { player });
      const who = r.name || player;
      say(action === 'grant' ? `${who} now has Eclipse Plus.` : r.removed ? `${who} no longer has Eclipse Plus.` : `${who} didn't have Eclipse Plus.`, 'ok', 'plusOwnerMsg');
      $('plusPlayer').value = '';
      loadUsers();
    } catch (err) {
      say(clean(err), 'bad', 'plusOwnerMsg');
    }
  }
  $('plusGrant').addEventListener('click', () => ownerAction('grant'));
  $('plusRevoke').addEventListener('click', () => ownerAction('revoke'));
})();
