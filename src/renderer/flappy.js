// Flappy Bird on the Play tab, with the player's own head as the bird. Click or press Space
// to flap. Your best score is kept on this PC (per account).
(() => {
  const canvas = document.getElementById('flappyCanvas');
  const g = canvas.getContext('2d');
  // The bird is the player's own head: the skin's face plus its hat layer, drawn into an 8x8 canvas.
  const head = document.createElement('canvas');
  head.width = head.height = 8;
  let headReady = false, headUrl = null;
  function loadHead() {
    const url = window.flappySkinUrl?.();
    if (!url || url === headUrl) return;
    headUrl = url;
    const img = new Image();
    img.onload = () => {
      const h = head.getContext('2d');
      h.imageSmoothingEnabled = false;
      h.clearRect(0, 0, 8, 8);
      h.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
      h.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
      headReady = true;
    };
    img.src = url;
  }

  const size = () => Math.round(Math.max(20, Math.min(34, 30 * unit())));
  const SPEED = 170, PIPE_W = 58, PIPE_EVERY = 1.55;
  // Jumps, gravity and the head scale with the height of the game, so it plays the same in any window.
  const unit = () => Math.max(0.5, (H - 28) / 360);
  const GRAVITY_AT = () => 1500 * unit(), FLAP_AT = () => -430 * unit();
  // The opening between pipes grows with the game area (small windows stay playable).
  const gap = () => Math.max(70, Math.min(150, (H - 28) * 0.42));

  let W = 0, H = 0, dpr = 1;
  let state = 'ready'; // ready | playing | over
  let y, vy, pipes, score, spawn, last = 0, groundX = 0, flash = 0, newBest = false;

  // Your best score, kept per account on this PC.
  const key = () => 'flappy-best:' + (window.flappyPlayerName?.() || 'Player');
  function best() {
    try { return Number(localStorage.getItem(key())) || 0; } catch { return 0; }
  }
  function saveBest(points) {
    try { localStorage.setItem(key(), String(points)); } catch { /* storage off: still playable */ }
  }

  function reset() {
    y = H * 0.42; vy = 0; pipes = []; score = 0; spawn = 0.6; newBest = false;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    if (state !== 'playing') reset();
  }

  function flap() {
    if (state === 'over') { if (performance.now() - flash < 450) return; state = 'ready'; reset(); return; }
    if (state === 'ready') state = 'playing';
    vy = FLAP_AT();
  }

  function die() {
    state = 'over';
    flash = performance.now();
    newBest = score > best();
    if (newBest) saveBest(score);
  }

  function step(dt) {
    groundX = (groundX - SPEED * dt) % 24;
    if (state !== 'playing') return;
    vy += GRAVITY_AT() * dt;
    y += vy * dt;
    spawn -= dt;
    if (spawn <= 0) {
      spawn = PIPE_EVERY;
      const margin = Math.max(10, Math.min(50, (H - 28 - gap()) / 4));
      pipes.push({ x: W + PIPE_W, top: margin + Math.random() * (H - 28 - gap() - margin * 2), passed: false });
    }
    const bx = W * 0.28;
    for (const p of pipes) {
      p.x -= SPEED * dt;
      if (!p.passed && p.x + PIPE_W < bx - size() / 2) { p.passed = true; score++; }
      // Hit test with a slightly forgiving box.
      const r = size() / 2 - 3;
      if (bx + r > p.x && bx - r < p.x + PIPE_W && (y - r < p.top || y + r > p.top + gap())) die();
    }
    pipes = pipes.filter(p => p.x > -PIPE_W);
    if (y + size() / 2 > H - 28) { y = H - 28 - size() / 2; die(); }
    if (y < size() / 2) { y = size() / 2; vy = 0; }
  }

  function draw(t) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // sky: dark with a faint red glow at the horizon
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#141012');
    sky.addColorStop(1, '#241417');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // pipes: blocky, red brick style
    for (const p of pipes) {
      for (const [top, h] of [[0, p.top], [p.top + gap(), H - 28 - p.top - gap()]]) {
        g.fillStyle = '#a31c26';
        g.fillRect(p.x, top, PIPE_W, h);
        g.fillStyle = '#e5323e';
        g.fillRect(p.x + 4, top, PIPE_W - 16, h);
        g.fillStyle = 'rgba(255,255,255,.12)';
        g.fillRect(p.x + 8, top, 5, h);
        // cap
        const capY = top === 0 ? p.top - 18 : top;
        g.fillStyle = '#c92833';
        g.fillRect(p.x - 5, capY, PIPE_W + 10, 18);
        g.fillStyle = '#5a1015';
        g.fillRect(p.x - 5, capY + (top === 0 ? 15 : 0), PIPE_W + 10, 3);
      }
    }

    // ground
    g.fillStyle = '#2a2224';
    g.fillRect(0, H - 28, W, 28);
    g.fillStyle = '#e5323e';
    g.fillRect(0, H - 28, W, 3);
    g.fillStyle = '#3a3033';
    for (let x = groundX; x < W; x += 24) g.fillRect(x, H - 18, 12, 4);

    // the head, tilted with the speed
    const bx = W * 0.28;
    const bob = state === 'ready' ? Math.sin(t / 220) * 6 : 0;
    const tilt = state === 'ready' ? 0 : Math.max(-0.45, Math.min(1.2, vy / (650 * unit())));
    g.save();
    g.translate(bx, y + bob);
    g.rotate(tilt);
    g.imageSmoothingEnabled = false;
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(-size() / 2 + 2, -size() / 2 + 3, size(), size());
    if (headReady) g.drawImage(head, -size() / 2, -size() / 2, size(), size());
    g.restore();

    // text
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.font = "20px 'Press Start 2P', monospace";
    if (state !== 'ready') {
      g.fillStyle = 'rgba(0,0,0,.5)';
      g.fillText(String(score), W / 2 + 3, 46);
      g.fillStyle = '#fff';
      g.fillText(String(score), W / 2, 43);
    }
    g.textAlign = 'right';
    g.font = '700 12px Inter, sans-serif';
    g.fillStyle = '#9b908d';
    g.fillText('BEST ' + best(), W - 14, 24);
    g.textAlign = 'center';
    if (state === 'ready') {
      g.font = "13px 'Press Start 2P', monospace";
      g.fillText('FLAPPY ' + (window.flappyPlayerName?.() || 'BIRD').toUpperCase(), W / 2, H * 0.24);
      g.font = '600 13px Inter, sans-serif';
      g.fillStyle = '#9b908d';
      g.fillText('Click or press Space to flap', W / 2, H * 0.24 + 26);
    }
    if (state === 'over') {
      g.fillStyle = 'rgba(16,14,15,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#e5323e';
      g.font = "16px 'Press Start 2P', monospace";
      g.fillText('GAME OVER', W / 2, H * 0.36);
      g.fillStyle = '#fff';
      g.font = '700 15px Inter, sans-serif';
      g.fillText(`Score ${score}  ·  Best ${best()}`, W / 2, H * 0.36 + 32);
      if (newBest) { g.fillStyle = '#ff6670'; g.fillText('New high score!', W / 2, H * 0.36 + 56); }
      g.fillStyle = '#9b908d';
      g.font = '600 12px Inter, sans-serif';
      g.fillText('Click or press Space to play again', W / 2, H * 0.36 + (newBest ? 80 : 60));
    }
  }

  function frame(t) {
    const tab = document.getElementById('tab-play');
    if (tab.classList.contains('active') && canvas.offsetParent) {
      loadHead();
      const r = canvas.getBoundingClientRect();
      if (Math.round(r.width) !== W || Math.round(r.height) !== H) resize();
      const dt = Math.min(0.033, (t - (last || t)) / 1000);
      step(dt);
      draw(t);
    }
    last = t;
    requestAnimationFrame(frame);
  }

  // For the launcher's own tests: the game state and a flap.
  window.flappyDebug = { state: () => ({ state, y, vy, score, H, W, gap: gap(), pipes: pipes.map(p => ({ x: p.x, top: p.top })) }), flap };

  canvas.addEventListener('mousedown', e => { e.preventDefault(); document.activeElement?.blur(); flap(); });
  // Space flaps while the Play tab is open and you're not typing somewhere.
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    if (!document.getElementById('tab-play').classList.contains('active')) return;
    if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    flap();
  });

  requestAnimationFrame(frame);
})();
