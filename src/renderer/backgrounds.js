// Background art behind the launcher (assets/backgrounds/1..N.webp). The whole picture always fits
// (a blurred copy fills the space around it), drifts slowly, and has twinkling stars and the odd
// shooting star over it. The arrows on the Play tab switch pictures with a zoom-and-sweep
// transition; the choice is remembered on this PC.
(() => {
  const COUNT = 3;
  const src = i => `../../assets/backgrounds/${i + 1}.webp`;
  const stage = document.getElementById('bgStage');
  const sparkles = document.getElementById('bgSparkles');
  const dots = document.getElementById('bgDots');
  let index = 0, layer = null, busy = false;
  try { index = Math.min(COUNT - 1, Math.max(0, Number(localStorage.getItem('bg-index')) || 0)); } catch { /* storage off */ }

  function makeLayer(i) {
    const el = document.createElement('div');
    el.className = 'bg-layer';
    el.innerHTML = '<div class="bg-fill"></div><div class="bg-img"></div>';
    for (const part of el.children) part.style.backgroundImage = `url("${src(i)}")`;
    return el;
  }

  function mark() {
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === index));
  }

  function show(i, dir = 1) {
    i = (i + COUNT) % COUNT;
    if (i === index || busy) return;
    busy = true;
    index = i;
    try { localStorage.setItem('bg-index', String(i)); } catch { /* storage off */ }
    mark();
    const old = layer;
    layer = makeLayer(i);
    layer.classList.add('enter');
    stage.append(layer);
    const sweep = document.createElement('div');
    sweep.className = `bg-sweep${dir < 0 ? ' back' : ''}`;
    stage.append(sweep);
    if (old) old.classList.add('leave');
    setTimeout(() => {
      old?.remove();
      sweep.remove();
      layer.classList.remove('enter');
      busy = false;
    }, 920);
  }

  // Twinkling stars: fixed spots so it's calm, each on its own rhythm.
  for (let n = 0; n < 34; n++) {
    const s = document.createElement('i');
    s.className = `bg-star${Math.random() < .2 ? ' big' : ''}`;
    s.style.left = `${Math.random() * 100}%`;
    s.style.top = `${Math.random() * 62}%`;
    s.style.setProperty('--d', `${3 + Math.random() * 4}s`);
    s.style.setProperty('--delay', `${-Math.random() * 7}s`);
    sparkles.append(s);
  }
  // Now and then a shooting star crosses the sky.
  function shoot() {
    if (!document.hidden) {
      const s = document.createElement('i');
      s.className = 'bg-shoot';
      s.style.left = `${45 + Math.random() * 50}%`;
      s.style.top = `${Math.random() * 30}%`;
      sparkles.append(s);
      setTimeout(() => s.remove(), 1200);
    }
    setTimeout(shoot, 6000 + Math.random() * 9000);
  }
  setTimeout(shoot, 2500);

  for (let i = 0; i < COUNT; i++) {
    const d = document.createElement('button');
    d.className = 'bg-dot';
    d.title = `Background ${i + 1}`;
    d.addEventListener('click', () => show(i, i > index ? 1 : -1));
    dots.append(d);
  }
  layer = makeLayer(index);
  stage.append(layer);
  mark();
  document.getElementById('bgPrev').addEventListener('click', () => show(index - 1, -1));
  document.getElementById('bgNext').addEventListener('click', () => show(index + 1, 1));
  window.backgroundDebug = { index: () => index, show };
})();
