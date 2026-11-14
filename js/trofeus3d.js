// ============================================================
//  TROFÉUS 3D (WebGL / three.js) · teaser do Versatte Cards (seção Campeonatos)
//  Os modelos são os do jogo (Versatte_card_game, js/game/trophy3d.js), modelados por código:
//   liga        → Taça dos Pontos Corridos (ouro, alças, base preta)
//   copa        → Troféu Mata-Mata (prata, bola facetada, louros de ouro)
//   continental → Taça Continental (ouro, faixas verdes, globo e estrelas)
//  Um único renderer WebGL desenha todos, cada um no seu <canvas> 2D. Sem WebGL ou sem
//  internet para baixar a biblioteca, continua o ícone de taça (CSS) que já está na página.
//  Módulo carregado por js/teaser-secoes.js. Para atualizar os modelos, copie de novo o trecho
//  de THREE_URL até o fim de buildTrophy() do jogo.
// ============================================================
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
let THREE = null, loading = null, renderer = null, envMap = null;
const mounts = new Set();

async function loadThree() {
  if (THREE) return THREE;
  loading = loading || import(THREE_URL).then(m => { THREE = m; return m; });
  return loading;
}

function ensureRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  // ambiente para reflexos metálicos: "estúdio" com painéis de luz coloridos
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.background = new THREE.Color('#0a0f1a');
  const panel = (color, intensity, pos, rot, w = 6, h = 3) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.rotation.set(...rot); env.add(m);
  };
  panel('#ffffff', 6, [0, 5, 0], [Math.PI / 2, 0, 0], 8, 8);
  panel('#ffd9a0', 3, [-5, 1, 2], [0, Math.PI / 2, 0]);
  panel('#7fc8ff', 3, [5, 1, -1], [0, -Math.PI / 2, 0]);
  panel('#ff8a1f', 2, [0, 0, -5], [0, 0, 0], 8, 2);
  panel('#ffffff', 1.5, [0, -3, 4], [-Math.PI / 4, 0, 0], 6, 1);
  envMap = pmrem.fromScene(env, 0.02).texture;
  return renderer;
}

// ------------------------------------------------------------
//  Materiais
// ------------------------------------------------------------
function materials(locked) {
  const M = (o) => new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 1.25, ...o });
  if (locked) {
    const dark = M({ color: '#1b2233', metalness: 0.6, roughness: 0.55 });
    return { gold: dark, silver: dark, black: M({ color: '#0b0f18', metalness: 0.3, roughness: 0.6 }), green: dark, gem: dark };
  }
  return {
    gold: M({ color: '#ffc04a', metalness: 1, roughness: 0.18 }),
    silver: M({ color: '#e8edf5', metalness: 1, roughness: 0.14 }),
    black: M({ color: '#0d1018', metalness: 0.5, roughness: 0.25 }),
    green: M({ color: '#0f8a4f', metalness: 0.35, roughness: 0.15 }),
    gem: M({ color: '#ff8a1f', metalness: 0.2, roughness: 0.05, emissive: '#ff6a00', emissiveIntensity: 0.6 }),
  };
}

const lathe = (pts, mat, seg = 64) => {
  const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
  const m = new THREE.Mesh(g, mat); m.material.side = THREE.DoubleSide; return m;
};
const cyl = (rt, rb, h, mat, y, seg = 48) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.y = y; return m; };
const ring = (r, tube, mat, y) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 16, 64), mat); m.rotation.x = Math.PI / 2; m.position.y = y; return m; };

function starShape(outer = 0.12, inner = 0.05) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  s.closePath();
  return s;
}

// ------------------------------------------------------------
//  Modelos
// ------------------------------------------------------------
function buildTrophy(type, locked) {
  const mat = materials(locked);
  const g = new THREE.Group();
  const spinners = [];

  if (type === 'liga') {
    // base escalonada preta com faixa de ouro
    g.add(cyl(0.62, 0.7, 0.22, mat.black, 0.11));
    g.add(cyl(0.5, 0.58, 0.2, mat.black, 0.32));
    g.add(ring(0.6, 0.025, mat.gold, 0.22));
    g.add(ring(0.5, 0.02, mat.gold, 0.42));
    // pé e haste
    g.add(lathe([[0, 0.42], [0.34, 0.42], [0.3, 0.48], [0.14, 0.56], [0.1, 0.78], [0.12, 0.86], [0.22, 0.9], [0.16, 0.96], [0.16, 1.0]], mat.gold));
    // taça
    g.add(lathe([[0.16, 1.0], [0.3, 1.06], [0.5, 1.22], [0.62, 1.45], [0.67, 1.72], [0.66, 1.86], [0.62, 1.88], [0.6, 1.86], [0, 1.2]], mat.gold));
    g.add(ring(0.655, 0.03, mat.gold, 1.86));
    g.add(ring(0.6, 0.018, mat.gold, 1.5));
    // alças
    [-1, 1].forEach(sgn => {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 16, 48, Math.PI * 1.15), mat.gold);
      h.position.set(sgn * 0.66, 1.5, 0); h.rotation.z = sgn > 0 ? -Math.PI * 0.55 : Math.PI * 0.4 + Math.PI;
      g.add(h);
    });
    // estrela frontal
    const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(0.14, 0.06), { depth: 0.04, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01 }), mat.gem);
    star.position.set(0, 1.5, 0.6); star.rotation.x = -0.12;
    g.add(star);
  }

  if (type === 'copa') {
    // base octogonal
    g.add(cyl(0.6, 0.66, 0.2, mat.black, 0.1, 8));
    g.add(cyl(0.48, 0.56, 0.22, mat.silver, 0.31, 8));
    g.add(ring(0.5, 0.025, mat.gold, 0.42));
    // coluna em anéis
    g.add(lathe([[0, 0.42], [0.36, 0.42], [0.18, 0.55], [0.14, 0.9], [0.2, 1.05], [0.13, 1.18], [0.12, 1.3], [0.26, 1.42], [0.3, 1.46], [0, 1.46]], mat.silver));
    [0.7, 0.95, 1.2].forEach(y => g.add(ring(0.16, 0.022, mat.gold, y)));
    // bola facetada
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 1.3, color: locked ? '#1b2233' : '#f4f7ff', metalness: 1, roughness: 0.12, flatShading: true }));
    ball.position.y = 1.86; g.add(ball); spinners.push(ball);
    const seams = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.425, 1)), new THREE.LineBasicMaterial({ color: locked ? '#0b0f18' : '#c99a2e' }));
    seams.position.y = 1.86; g.add(seams); spinners.push(seams);
    // louros de ouro abraçando a bola
    [-1, 1].forEach(sgn => {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 12, 48, Math.PI * 0.85), mat.gold);
      arc.position.y = 1.78; arc.rotation.z = -Math.PI * 0.1;       // arco de -18° a 135°
      arc.rotation.y = sgn > 0 ? 0 : Math.PI;                         // o esquerdo é o espelho do direito
      g.add(arc);
      for (let i = 0; i < 6; i++) {
        const a = -0.1 * Math.PI + (i / 6) * Math.PI * 0.8;
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), mat.gold);
        leaf.scale.set(1, 0.45, 0.45);
        leaf.position.set(Math.cos(a) * 0.5 * sgn, 1.78 + Math.sin(a) * 0.5, 0);
        leaf.rotation.z = a + (sgn > 0 ? 0.6 : -0.6);
        g.add(leaf);
      }
    });
  }

  if (type === 'continental') {
    // base de ouro com faixas verdes (malaquita)
    g.add(cyl(0.6, 0.64, 0.14, mat.gold, 0.07));
    g.add(cyl(0.58, 0.6, 0.1, mat.green, 0.19));
    g.add(cyl(0.54, 0.58, 0.1, mat.gold, 0.29));
    g.add(cyl(0.52, 0.54, 0.08, mat.green, 0.38));
    // corpo em espiral que se abre
    g.add(lathe([[0, 0.42], [0.5, 0.42], [0.36, 0.5], [0.24, 0.7], [0.2, 0.95], [0.24, 1.2], [0.36, 1.42], [0.44, 1.56], [0.38, 1.62], [0, 1.62]], mat.gold));
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Mesh(new THREE.TorusGeometry(0.26 - i * 0.02, 0.025, 10, 40, Math.PI * 1.4), mat.gold);
      sp.position.y = 0.75 + i * 0.25; sp.rotation.set(Math.PI / 2 + 0.35, 0, i * 2.1);
      g.add(sp);
    }
    // globo
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.4, 48, 32), mat.gold);
    globe.position.y = 2.0; g.add(globe);
    const grid = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(0.405, 12, 8)), new THREE.LineBasicMaterial({ color: locked ? '#0b0f18' : '#8a5a00' }));
    grid.position.y = 2.0; g.add(grid); spinners.push(globe, grid);
    // estrelas orbitando
    const orbit = new THREE.Group(); orbit.position.y = 2.0;
    for (let i = 0; i < 4; i++) {
      const st = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(0.09, 0.038), { depth: 0.03, bevelEnabled: false }), locked ? mat.gold : mat.gem);
      const a = (i / 4) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.62, Math.sin(a * 2) * 0.08, Math.sin(a) * 0.62);
      orbit.add(st);
    }
    g.add(orbit); spinners.push(orbit);
  }

  if (type === 'online') {
    // Troféu online: cálice de cristal neon com anel de luz e gema girando
    const crystal = new THREE.MeshPhysicalMaterial({
      envMap, envMapIntensity: 1.4, color: locked ? '#1b2233' : '#9fe6ff', metalness: 0, roughness: 0.04,
      transmission: locked ? 0 : 0.85, thickness: 0.6, ior: 1.5, transparent: true, opacity: locked ? 1 : 0.9,
      emissive: locked ? '#000000' : '#0a4a7a', emissiveIntensity: 0.5, side: THREE.DoubleSide,
    });
    const neon = new THREE.MeshStandardMaterial({ color: locked ? '#1b2233' : '#7fd0ff', emissive: locked ? '#000' : '#33b5ff', emissiveIntensity: 2.2 });
    g.add(cyl(0.6, 0.66, 0.16, mat.black, 0.08, 6));
    g.add(cyl(0.5, 0.58, 0.16, mat.black, 0.24, 6));
    g.add(ring(0.6, 0.02, neon, 0.17));
    g.add(ring(0.5, 0.018, neon, 0.33));
    g.add(lathe([[0, 0.32], [0.3, 0.32], [0.12, 0.45], [0.08, 0.9], [0.14, 1.0], [0.4, 1.2], [0.58, 1.55], [0.6, 1.8], [0.56, 1.82], [0, 1.25]], crystal));
    g.add(ring(0.58, 0.02, neon, 1.8));
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.025, 12, 80), neon);
    halo.position.y = 1.45; halo.rotation.x = Math.PI / 2.4;
    g.add(halo); spinners.push(halo);
    const gemTop = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ envMap, color: locked ? '#1b2233' : '#ffc940', metalness: 0.6, roughness: 0.1, emissive: locked ? '#000' : '#ff8a1f', emissiveIntensity: 0.7, flatShading: true }));
    gemTop.position.y = 2.15; g.add(gemTop); spinners.push(gemTop);
  }

  g.position.y = -1.05;
  return { group: g, spinners };
}

// ------------------------------------------------------------
//  Montagem no site (teaser): um canvas por troféu, girando sozinho; arrastar gira.
//  O three.js só é baixado quando a seção chega perto da tela.
// ------------------------------------------------------------
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let raf = 0, last = performance.now();

function montar(el) {
  const tipo = el.dataset.trofeu;
  const canvas = document.createElement('canvas');
  canvas.className = 'tzs-trofeu__tela';
  canvas.setAttribute('aria-hidden', 'true');
  el.appendChild(canvas);
  const m = { el, canvas, ctx: canvas.getContext('2d'), rotY: Math.random() * Math.PI * 2, drag: null, vel: 0, t0: 0, visivel: false };
  loadThree().then(() => {
    try { ensureRenderer(); } catch { canvas.remove(); return; }   // sem WebGL: fica o ícone
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#bcd6ff', '#1a1208', 0.6));
    const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(2, 4, 3); scene.add(key);
    const rim = new THREE.DirectionalLight('#ff8a1f', 1.6); rim.position.set(-3, 2, -2); scene.add(rim);
    const rim2 = new THREE.DirectionalLight('#2e9bff', 1.2); rim2.position.set(3, 1, -3); scene.add(rim2);
    const { group, spinners } = buildTrophy(tipo, false);
    scene.add(group);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    cam.position.set(0, 0.35, 5.2); cam.lookAt(0, 0.1, 0);
    Object.assign(m, { scene, group, spinners, cam, t0: performance.now() });
    el.classList.add('is-3d');
    mounts.add(m);
    if (!raf) raf = requestAnimationFrame(loop);
  }).catch(() => canvas.remove());
  // arrastar para os lados gira o troféu (na vertical, a página rola normalmente)
  canvas.addEventListener('pointerdown', e => { m.drag = e.clientX; m.vel = 0; canvas.setPointerCapture?.(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (m.drag == null) return; const dx = e.clientX - m.drag; m.drag = e.clientX; m.rotY += dx * 0.012; m.vel = dx * 0.012; });
  const solta = () => { m.drag = null; };
  canvas.addEventListener('pointerup', solta); canvas.addEventListener('pointercancel', solta);
  return m;
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (const m of mounts) {
    const r = m.el.getBoundingClientRect();
    if (r.width < 2 || r.bottom < 0 || r.top > innerHeight) continue;      // fora da tela: não desenha
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (m.canvas.width !== w || m.canvas.height !== h) { m.canvas.width = w; m.canvas.height = h; }
    if (m.drag == null) { m.vel *= 0.94; m.rotY += m.vel + (reduce ? 0 : 0.6) * dt; }
    m.group.rotation.y = m.rotY;
    // entrada: o troféu sobe girando e cresce na primeira vez que aparece
    if (!m.visto) { m.visto = true; m.t0 = now; }
    const k = reduce ? 1 : Math.min(1, (now - m.t0) / 1400), e = 1 - Math.pow(1 - k, 3);
    m.group.scale.setScalar(0.2 + 0.8 * e);
    m.group.rotation.y += (1 - e) * 6;
    m.group.position.y = -1.05 + (1 - e) * -1.5 + (reduce ? 0 : Math.sin(now / 900) * 0.03);
    if (!reduce) m.spinners.forEach((s, i) => { s.rotation.y += dt * (i % 2 ? -0.6 : 0.9); });
    renderer.setSize(w, h, false);
    m.cam.aspect = w / h; m.cam.updateProjectionMatrix();
    renderer.render(m.scene, m.cam);
    m.ctx.clearRect(0, 0, w, h);
    m.ctx.drawImage(renderer.domElement, 0, 0, w, h);
  }
  raf = requestAnimationFrame(loop);
}

/** Monta os troféus [data-trofeu] de root quando ela chega perto da tela. */
export function montarTrofeus(root) {
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    root.querySelectorAll('[data-trofeu]').forEach(montar);
  }, { rootMargin: '600px 0px' });
  io.observe(root);
}
