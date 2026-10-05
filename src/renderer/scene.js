// Procedural pixel-art landscape behind the Play tab: blocky terrain, trees, drifting clouds,
// a sky that follows the real clock (day, sunset, night with stars, moon and fireflies)
// and a little mouse parallax.
(() => {
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const T = 4;       // screen pixels per texel
  const B = 8 * T;   // block size (8x8 texels)
  const MARGIN = 32; // extra terrain on each side for parallax

  let seed = (Math.random() * 1e9) | 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) | 0) >>> 0) / 4294967296;

  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function shade(rgb, k) { return `rgb(${rgb.map(v => Math.max(0, Math.min(255, v * k | 0))).join(',')})`; }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = c => `rgb(${c.join(',')})`;

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
    diamond: variants(1, (x, y) => [((x + y * 3) % 5 === 0 && rand() < 0.7) ? '#4fe3e0' : '#8a8a8a']),
    log: variants(2, x => [x === 0 || x === 7 ? '#5a4024' : (x % 3 === 1 ? '#6e5030' : '#7c5a35')]),
    leaves: variants(3, () => (rand() < 0.12 ? null : [rand() < 0.3 ? '#3f8a22' : '#4fa52c'])),
  };
  const pick = list => list[(rand() * list.length) | 0];

  let terrain = null;  // pre-rendered landscape
  let shadow = null;   // same shape, solid night blue - drawn on top at night
  let clouds = [];
  let stars = [];
  let fireflies = [];
  let surface = [];    // terrain top (px) per column, for fireflies

  function build() {
    const w = canvas.width + MARGIN * 2, h = canvas.height;
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
    surface = heights.map(hh => hh * B);

    for (let x = 0; x < cols; x++) {
      const top = heights[x];
      for (let y = top; y < rows; y++) {
        const depth = y - top;
        const t = depth === 0 ? pick(tex.grass)
          : depth < 3 + (x % 2) ? pick(tex.dirt)
          : rand() < 0.012 && depth > 5 ? tex.diamond[0]
          : rand() < 0.05 ? pick(tex.ore) : pick(tex.stone);
        g.drawImage(t, x * B, y * B);
      }
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

    shadow = document.createElement('canvas');
    shadow.width = w; shadow.height = h;
    const s = shadow.getContext('2d');
    s.drawImage(terrain, 0, 0);
    s.globalCompositeOperation = 'source-in';
    s.fillStyle = '#0a1030';
    s.fillRect(0, 0, w, h);

    clouds = Array.from({ length: Math.ceil(w / 260) + 2 }, () => newCloud(rand() * w));
    stars = Array.from({ length: Math.round(canvas.width * canvas.height / 5200) }, () => ({
      x: rand() * canvas.width, y: rand() * canvas.height * 0.55, size: rand() < 0.15 ? 3 : 2, phase: rand() * Math.PI * 2, speed: 0.6 + rand() * 1.8,
    }));
    fireflies = Array.from({ length: 18 }, () => newFirefly());
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

  function newFirefly() {
    const x = rand() * (canvas.width + MARGIN * 2);
    const col = Math.min(surface.length - 1, Math.max(0, Math.floor(x / B)));
    return { x, y: (surface[col] || canvas.height * 0.6) - 10 - rand() * B * 3, vx: (rand() - 0.5) * 14, vy: (rand() - 0.5) * 8, phase: rand() * 6.28 };
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    canvas.width = Math.round(r.width);
    canvas.height = Math.round(r.height);
    ctx.imageSmoothingEnabled = false;
    build();
  }

  // 0 = night, 0.5 = sunrise/sunset, 1 = day, from the local clock.
  function daylight(hour) {
    const ramp = (h, a, b) => Math.max(0, Math.min(1, (h - a) / (b - a)));
    if (hour < 12) return ramp(hour, 5.5, 8);
    return 1 - ramp(hour, 18, 20.5);
  }
  const SKY = {
    night: [hex('#070b1f'), hex('#1a2350')],
    dusk: [hex('#2b2463'), hex('#f2875a')],
    day: [hex('#4f9de6'), hex('#bfe3ff')],
  };
  function skyColors(d) {
    if (d <= 0.5) { const t = d / 0.5; return [mix(SKY.night[0], SKY.dusk[0], t), mix(SKY.night[1], SKY.dusk[1], t)]; }
    const t = (d - 0.5) / 0.5;
    return [mix(SKY.dusk[0], SKY.day[0], t), mix(SKY.dusk[1], SKY.day[1], t)];
  }

  // Smoothed mouse parallax (-1..1).
  let mx = 0, my = 0, tx = 0, ty = 0;
  window.addEventListener('mousemove', e => {
    tx = (e.clientX / window.innerWidth) * 2 - 1;
    ty = (e.clientY / window.innerHeight) * 2 - 1;
  });

  let lastT = performance.now();
  function frame(now) {
    // While Minecraft runs, the launcher sits idle so every frame goes to the game.
    if (document.body.dataset.game === 'running') { lastT = now; setTimeout(() => requestAnimationFrame(frame), 1000); return; }
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (terrain && canvas.offsetParent !== null) {
      const w = canvas.width, h = canvas.height;
      const date = new Date();
      const hour = window.__sceneHour ?? (date.getHours() + date.getMinutes() / 60);
      const d = daylight(hour);
      const night = 1 - d;
      mx += (tx - mx) * Math.min(1, dt * 3);
      my += (ty - my) * Math.min(1, dt * 3);

      const [top, bottom] = skyColors(d);
      const sky = ctx.createLinearGradient(0, 0, 0, h * 0.75);
      sky.addColorStop(0, rgb(top));
      sky.addColorStop(1, rgb(bottom));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Stars
      if (night > 0.05) {
        for (const s of stars) {
          const a = night * (0.45 + 0.55 * Math.sin(now / 1000 * s.speed + s.phase) ** 2);
          ctx.fillStyle = `rgba(255,255,240,${a.toFixed(3)})`;
          ctx.fillRect(Math.round(s.x - mx * 3), Math.round(s.y - my * 2), s.size, s.size);
        }
      }

      // Sun by day, moon by night - both square, both arc across the sky.
      const arc = (t, size) => {
        const x = w * (0.1 + 0.8 * t) - mx * 6;
        const y = h * 0.42 - Math.sin(t * Math.PI) * h * 0.34;
        return [Math.round(x - size / 2), Math.round(y - size / 2)];
      };
      const sunT = Math.max(0, Math.min(1, (hour - 6) / 13));
      if (d > 0.02) {
        const size = B * 1.6;
        const [sx, sy] = arc(sunT, size);
        ctx.fillStyle = `rgba(255,240,170,${(0.25 * d).toFixed(3)})`;
        ctx.fillRect(sx - 14, sy - 14, size + 28, size + 28);
        ctx.fillStyle = rgb(mix(hex('#ffb347'), hex('#fff6c9'), d));
        ctx.fillRect(sx, sy, size, size);
      }
      if (night > 0.02) {
        const moonT = ((hour + 24 - 19) % 24) / 11;
        const size = B * 1.3;
        const [x0, y0] = arc(Math.max(0, Math.min(1, moonT)), size);
        ctx.fillStyle = `rgba(220,230,255,${(0.9 * night).toFixed(3)})`;
        ctx.fillRect(x0, y0, size, size);
        ctx.fillStyle = `rgba(150,160,190,${(0.6 * night).toFixed(3)})`;
        ctx.fillRect(x0 + size * 0.2, y0 + size * 0.25, size * 0.25, size * 0.25);
        ctx.fillRect(x0 + size * 0.6, y0 + size * 0.55, size * 0.2, size * 0.2);
      }

      // Clouds pick up the sky's mood.
      const cloudCol = d > 0.5 ? mix(hex('#ffd2b8'), hex('#ffffff'), (d - 0.5) * 2) : mix(hex('#4a5480'), hex('#ffd2b8'), d * 2);
      ctx.fillStyle = `rgba(${cloudCol.join(',')},${(0.35 + 0.57 * d).toFixed(3)})`;
      for (const c of clouds) {
        c.x += c.speed * dt;
        const ox = -mx * 10;
        for (const [bx, by] of c.blocks) ctx.fillRect(Math.round(c.x + bx * c.size + ox), Math.round(c.y + by * c.size * 0.5), Math.ceil(c.size), Math.ceil(c.size * 0.5));
        if (c.x > w + MARGIN * 2) Object.assign(c, newCloud(-c.blocks.length * c.size));
      }

      // Terrain (with parallax), darkened at night.
      const ox = Math.round(-MARGIN - mx * 18);
      const oy = Math.round(-my * 6);
      ctx.drawImage(terrain, ox, oy);
      if (night > 0.02) {
        ctx.globalAlpha = 0.62 * night;
        ctx.drawImage(shadow, ox, oy);
        ctx.globalAlpha = 1;
      }

      // Fireflies after dark.
      if (night > 0.3) {
        for (const f of fireflies) {
          f.phase += dt * 2.2;
          f.x += (f.vx + Math.sin(f.phase) * 6) * dt;
          f.y += (f.vy + Math.cos(f.phase * 0.7) * 5) * dt;
          if (f.x < 0 || f.x > w + MARGIN * 2 || f.y < h * 0.3 || f.y > h) Object.assign(f, newFirefly());
          const glow = (0.4 + 0.6 * Math.sin(f.phase * 1.7) ** 2) * (night - 0.3) / 0.7;
          const x = Math.round(f.x + ox), y = Math.round(f.y + oy);
          ctx.fillStyle = `rgba(200,255,120,${(glow * 0.25).toFixed(3)})`;
          ctx.fillRect(x - 4, y - 4, 10, 10);
          ctx.fillStyle = `rgba(230,255,150,${glow.toFixed(3)})`;
          ctx.fillRect(x, y, 3, 3);
        }
      }

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
