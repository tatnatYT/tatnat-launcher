// Procedural pixel-art landscape behind the Play tab: blocky terrain, trees and drifting clouds.
(() => {
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const T = 4;       // screen pixels per texel
  const B = 8 * T;   // block size (8x8 texels)

  let seed = (Math.random() * 1e9) | 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) | 0) >>> 0) / 4294967296;

  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function shade(rgb, k) { return `rgb(${rgb.map(v => Math.max(0, Math.min(255, v * k | 0))).join(',')})`; }

  // Builds an 8x8 texel texture; paint(x, y) returns [color, brightness] or null for transparent.
  function texture(paint) {
    const c = document.createElement('canvas');
    c.width = c.height = B;
    const g = c.getContext('2d');
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const px = paint(x, y);
      if (!px) continue;
      g.fillStyle = shade(hex(px[0]), px[1] ?? (0.86 + rand() * 0.24));
      g.fillRect(x * T, y * T, T, T);
    }
    return c;
  }

  const variants = (n, paint) => Array.from({ length: n }, () => texture(paint));
  const tex = {
    grass: variants(4, (x, y) => {
      const edge = 2 + ((x * 7 + 3) % 3 === 0 ? 1 : 0) + (rand() < 0.25 ? 1 : 0);
      return y < edge ? ['#6cbf3f'] : ['#86603a'];
    }),
    dirt: variants(4, () => [rand() < 0.12 ? '#6b4a2b' : '#86603a']),
    stone: variants(4, () => [rand() < 0.15 ? '#6f6f6f' : '#8a8a8a']),
    ore: variants(2, (x, y) => [((x + y * 3) % 5 === 0 && rand() < 0.7) ? '#3a3a3a' : '#8a8a8a']),
    log: variants(2, x => [x === 0 || x === 7 ? '#5a4024' : (x % 3 === 1 ? '#6e5030' : '#7c5a35')]),
    leaves: variants(3, () => (rand() < 0.12 ? null : [rand() < 0.3 ? '#3f8a22' : '#4fa52c'])),
  };
  const pick = list => list[(rand() * list.length) | 0];

  let terrain = null; // pre-rendered landscape
  let clouds = [];

  function build() {
    const w = canvas.width, h = canvas.height;
    const cols = Math.ceil(w / B) + 1;
    const rows = Math.ceil(h / B) + 1;
    terrain = document.createElement('canvas');
    terrain.width = w; terrain.height = h;
    const g = terrain.getContext('2d');

    // Height map: layered sines + a little noise, kept so hills peek above the dock.
    const phase = rand() * 100;
    const base = Math.floor(rows * 0.58);
    const heights = [];
    let jitter = 0;
    for (let x = 0; x < cols; x++) {
      if (rand() < 0.3) jitter += rand() < 0.5 ? -1 : 1;
      jitter = Math.max(-1, Math.min(1, jitter));
      heights.push(base + Math.round(Math.sin(x * 0.19 + phase) * 2.2 + Math.sin(x * 0.07 + phase * 2) * 2.5) + jitter);
    }

    for (let x = 0; x < cols; x++) {
      const top = heights[x];
      for (let y = top; y < rows; y++) {
        const depth = y - top;
        const t = depth === 0 ? pick(tex.grass) : depth < 3 + (x % 2) ? pick(tex.dirt) : rand() < 0.05 ? pick(tex.ore) : pick(tex.stone);
        g.drawImage(t, x * B, y * B);
      }
      // Darken deeper rows a little for depth.
      const grad = g.createLinearGradient(0, top * B, 0, h);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = grad;
      g.fillRect(x * B, top * B, B, h);
    }

    // Trees on flat-ish spots.
    for (let x = 2; x < cols - 2; x++) {
      if (rand() > 0.13 || heights[x - 1] !== heights[x]) continue;
      const top = heights[x];
      const trunk = 3 + ((rand() * 2) | 0);
      for (let i = 1; i <= trunk; i++) g.drawImage(pick(tex.log), x * B, (top - i) * B);
      const crown = top - trunk;
      for (let dy = -2; dy <= 0; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dy === -2 && Math.abs(dx) === 2) continue;
        if (dy === 0 && dx === 0) continue;
        g.drawImage(pick(tex.leaves), (x + dx) * B, (crown + dy) * B);
      }
      g.drawImage(pick(tex.leaves), x * B, (crown - 3) * B);
      x += 3;
    }

    clouds = Array.from({ length: Math.ceil(w / 260) + 2 }, () => newCloud(rand() * w));
  }

  function newCloud(x) {
    const blocks = [];
    const len = 3 + ((rand() * 5) | 0);
    for (let i = 0; i < len; i++) {
      blocks.push([i, 0]);
      if (rand() < 0.5 && i > 0 && i < len - 1) blocks.push([i, -1]);
    }
    return { x, y: B * (0.6 + rand() * 4.5), speed: 6 + rand() * 10, blocks, size: B * 1.25 };
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    canvas.width = Math.round(r.width);
    canvas.height = Math.round(r.height);
    ctx.imageSmoothingEnabled = false;
    build();
  }

  let lastT = performance.now();
  function frame(now) {
    // While Minecraft runs, the launcher sits idle so every frame goes to the game.
    if (document.body.dataset.game === 'running') { lastT = now; setTimeout(() => requestAnimationFrame(frame), 1000); return; }
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (terrain && canvas.offsetParent !== null) {
      const w = canvas.width, h = canvas.height;
      const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
      sky.addColorStop(0, '#5aa4e6');
      sky.addColorStop(1, '#bfe3ff');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#fff6c9';
      ctx.fillRect(w - B * 4, B * 1.2, B * 1.5, B * 1.5);

      for (const c of clouds) {
        c.x += c.speed * dt;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        for (const [bx, by] of c.blocks) ctx.fillRect(Math.round(c.x + bx * c.size), Math.round(c.y + by * c.size * 0.5), Math.ceil(c.size), Math.ceil(c.size * 0.5));
        if (c.x > w) Object.assign(c, newCloud(-c.blocks.length * c.size));
      }

      ctx.drawImage(terrain, 0, 0);

      // Soft shade at the top so the heading stays readable.
      const veil = ctx.createLinearGradient(0, 0, 0, h * 0.4);
      veil.addColorStop(0, 'rgba(10,14,22,0.45)');
      veil.addColorStop(1, 'rgba(10,14,22,0)');
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, w, h * 0.4);
    }
    requestAnimationFrame(frame);
  }

  new ResizeObserver(resize).observe(canvas);
  requestAnimationFrame(frame);
})();
