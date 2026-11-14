/* ============================================================
   VERSATTE CARDS · TEASER (versatteCards.html)
   Linha do tempo (ms):
     0      fundo acende e as partículas sobem
     150    feixe de luz abre no centro
     800    as cartas do jogo entram voando e formam um leque
     3300   o leque vira um carrossel 3D, que acelera
     5800   as cartas se juntam no centro: clarão e explosão de faíscas
     6200   logos da Versatte e da Beyond Bits, "Versatte Cards", "Em breve"
     8300   as cartas voltam pequenas, girando devagar atrás das logos
   "Pular" leva direto ao final; o botão de repetir roda de novo.
   Com "reduzir movimento" ligado no aparelho, mostra só o final, parado.
   As cartas vêm de js/vitrine-cartas.js (HTML gerado pelo próprio jogo); as seções de baixo
   (rolando a página) ficam em js/teaser-secoes.js.
   ============================================================ */
(() => {
  const tz = document.querySelector('[data-tz]');
  if (!tz) return;
  const $ = s => tz.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ring = $('[data-tz-ring]'), beam = $('[data-tz-beam]'), flash = $('[data-tz-flash]'), dim = $('[data-tz-dim]');
  const canvas = $('[data-tz-particles]'), skipBtn = $('[data-tz-skip]'), replayBtn = $('[data-tz-replay]');
  const R = n => $(`[data-tz-r="${n}"]`);
  const V = window.VERSATTE_VITRINE || { intro: [], cartas: {} };
  const CARTAS = (V.intro || []).map(u => V.cartas[u]).filter(Boolean);

  /* ---------- partículas (poeira dourada e azul subindo; faíscas no clarão) ---------- */
  const ctx = canvas.getContext('2d');
  const CORES = ['255,208,138', '255,150,70', '156,203,255', '255,255,255'];
  let W = 0, H = 0, poeira = [], faiscas = [], quadro = 0, mestre = null, eventos = [], orbita = [], visivel = true, girando = false;
  const medir = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const grao = y => ({ x: Math.random() * W, y: y ?? Math.random() * H, r: .5 + Math.random() * 1.6, v: .12 + Math.random() * .42, d: (Math.random() - .5) * .22, f: Math.random() * 6.28, c: CORES[Math.random() * CORES.length | 0] });
  const semear = () => { poeira = Array.from({ length: Math.round(Math.min(110, W * H / 13000)) }, () => grao()); };
  const explodir = () => {
    const n = W < 700 ? 120 : 200, cx = W / 2, cy = H * .47;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (2.5 + Math.random() * 12) * (W < 700 ? .7 : 1);
      faiscas.push({ x: cx, y: cy, px: cx, py: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vida: 1, dec: .007 + Math.random() * .012, c: CORES[Math.random() * 3 | 0], r: .7 + Math.random() * 1.7 });
    }
  };
  const desenhar = () => {
    quadro++;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of poeira) {
      if (!reduce) { p.y -= p.v; p.x += p.d + Math.sin(quadro / 90 + p.f) * .15; }
      if (p.y < -10) Object.assign(p, grao(H + 10));
      const a = .32 + Math.sin(quadro / 40 + p.f) * .28;
      ctx.fillStyle = `rgba(${p.c},${(a * .22).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3.4, 0, 6.283); ctx.fill();
      ctx.fillStyle = `rgba(${p.c},${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
    }
    ctx.lineCap = 'round';
    for (let i = faiscas.length - 1; i >= 0; i--) {
      const s = faiscas[i];
      s.px = s.x; s.py = s.y; s.x += s.vx; s.y += s.vy; s.vx *= .955; s.vy = s.vy * .955 + .025; s.vida -= s.dec;
      if (s.vida <= 0) { faiscas.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(${s.c},${s.vida.toFixed(3)})`; ctx.lineWidth = s.r;
      ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // eventos da linha do tempo, no relógio da animação (num aparelho lento, tudo atrasa junto)
    if (mestre && eventos.length) { const agora = mestre.currentTime ?? 0; while (eventos.length && agora >= eventos[0].t) eventos.shift().fn(); }
    if (!reduce && visivel) requestAnimationFrame(desenhar); else girando = false;
  };
  const ligar = () => { if (!girando) { girando = true; requestAnimationFrame(desenhar); } };
  medir(); semear(); ligar();
  // fora da tela (a pessoa rolou para as seções), a abertura para de gastar bateria
  new IntersectionObserver(([e]) => {
    visivel = e.isIntersecting;
    if (visivel && !reduce) ligar();
    orbita.forEach(a => (visivel ? a.play() : a.pause()));
  }).observe(tz);
  addEventListener('resize', () => { medir(); semear(); if (reduce) desenhar(); });

  if (reduce || !CARTAS.length || !Element.prototype.animate) return;   // sem animação: o final já está na tela
  tz.classList.add('js');

  /* ---------- cartas ---------- */
  // transformação com a mesma lista de funções em todos os momentos (a animação interpola valor a valor)
  const T = ({ x = 0, y = 0, z = 0, rz = 0, ry = 0, tz = 0, rx = 0, s = 1 }) =>
    `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) rotateZ(${rz.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateZ(${tz.toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) scale(${s.toFixed(3)})`;
  const rnd = (a, b) => a + Math.random() * (b - a);
  let cartas = [], anims = [], fim = false, rodada = 0;

  const montar = () => {
    ring.textContent = '';
    const lista = innerWidth < 700 ? CARTAS.slice(0, 12) : CARTAS;   // menos cartas no celular
    cartas = lista.map(html => {
      const el = document.createElement('div');
      el.className = 'tz-card';
      el.innerHTML = html;
      ring.appendChild(el);
      return el;
    });
  };

  const tocar = (el, kf, opt) => { const a = el.animate(kf, { fill: 'both', ...opt }); anims.push(a); return a; };
  const depois = (t, fn) => { eventos.push({ t, fn }); eventos.sort((a, b) => a.t - b.t); };

  const D = 6400;   // duração da parte das cartas (entrada, leque, carrossel, clarão)
  function rodar() {
    fim = false;
    tz.classList.remove('is-done');
    montar();
    eventos = [];
    mestre = tz.animate([], { duration: 10000, fill: 'forwards' });   // só o relógio
    anims.push(mestre);
    const n = cartas.length, pequeno = innerWidth < 700;
    const tw = pequeno ? Math.min(132, Math.max(90, innerWidth * .29)) : Math.min(212, Math.max(120, Math.min(innerWidth * .145, innerHeight * .26)));
    ring.style.setProperty('--tw', `${tw.toFixed(0)}px`);
    const ch = tw * 88 / 63;
    // leque: arco com pivô bem abaixo da tela
    const abre = pequeno ? 74 : 86, metade = innerWidth * (pequeno ? .4 : .37);
    const raioLeque = metade / Math.sin((abre / 2) * Math.PI / 180), queda = raioLeque * (1 - Math.cos((abre / 2) * Math.PI / 180));
    // carrossel
    const raio = Math.max(tw * n / (2 * Math.PI) * 1.22, pequeno ? 170 : 380);
    const ordem = [...cartas.keys()].sort(() => Math.random() - .5);

    cartas.forEach((el, i) => {
      const th = -abre / 2 + abre * i / Math.max(1, n - 1), rad = th * Math.PI / 180;
      const leque = { x: raioLeque * Math.sin(rad), y: raioLeque * (1 - Math.cos(rad)) - queda / 2 - ch * .05, z: i * 1.5, rz: th };
      const phi = i * 360 / n;
      const inicio = { x: rnd(-.7, .7) * innerWidth, y: rnd(-.6, .6) * innerHeight, z: -3600, rz: rnd(-120, 120), ry: rnd(-720, 720), rx: rnd(-80, 80), s: .2 };
      const chega = 800 + ordem.indexOf(i) * (pequeno ? 70 : 55);
      tocar(el, [
        { offset: 0, transform: T({ ...inicio, s: 0 }) },
        { offset: chega / D, transform: T({ ...inicio, s: 0 }), easing: 'linear' },
        { offset: (chega + 60) / D, transform: T(inicio), easing: 'cubic-bezier(.16,.84,.24,1)' },
        { offset: (chega + 1150) / D, transform: T(leque), easing: 'ease-in-out' },
        { offset: 3300 / D, transform: T({ ...leque, y: leque.y - 10 }), easing: 'cubic-bezier(.6,0,.25,1)' },
        { offset: 4700 / D, transform: T({ ry: phi - 150, tz: raio, s: .92 }), easing: 'cubic-bezier(.45,0,.9,.55)' },
        { offset: 5800 / D, transform: T({ ry: phi - 560, tz: raio * .9, s: .88 }), easing: 'cubic-bezier(.55,0,1,.6)' },
        { offset: 6150 / D, transform: T({ ry: phi - 780, tz: 0, s: .32 }), easing: 'ease-in' },
        { offset: 1, transform: T({ ry: phi - 820, tz: 0, s: 0 }) },
      ], { duration: D });
    });
    tocar(ring, [
      { offset: 0, transform: 'translateY(0px) rotateX(0deg) rotateY(0deg)' },
      { offset: 3300 / D, transform: 'translateY(0px) rotateX(0deg) rotateY(0deg)', easing: 'cubic-bezier(.6,0,.25,1)' },
      { offset: 4700 / D, transform: 'translateY(0px) rotateX(-13deg) rotateY(0deg)' },
      { offset: 5800 / D, transform: 'translateY(0px) rotateX(-7deg) rotateY(0deg)' },
      { offset: 1, transform: 'translateY(0px) rotateX(0deg) rotateY(0deg)' },
    ], { duration: D });

    tocar(beam, [
      { opacity: 0, transform: 'scaleX(0)' },
      { opacity: 1, transform: 'scaleX(.2)', offset: .12 },
      { opacity: 1, transform: 'scaleX(1) scaleY(1)', offset: .5 },
      { opacity: 0, transform: 'scaleX(1.15) scaleY(3)' },
    ], { duration: 1900, delay: 150, easing: 'cubic-bezier(.3,.7,.3,1)' });
    tocar(flash, [{ opacity: 0 }, { opacity: 1, offset: .16 }, { opacity: 0 }], { duration: 1300, delay: 5980, easing: 'ease-out' });
    depois(6080, explodir);

    // revelação
    const sobe = (el, delay, dur = 900, dist = 14) => tocar(el, [{ opacity: 0, transform: `translateY(${dist}px)` }, { opacity: 1, transform: 'none' }], { duration: dur, delay, easing: 'cubic-bezier(.2,.8,.2,1)' });
    tocar(R('halo'), [{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 1700, delay: 6100, easing: 'cubic-bezier(.2,.8,.2,1)' });
    tocar(R('logos'), [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 6200 });
    tocar($('.tz__vs'), [{ transform: 'scale(.55)', filter: 'blur(14px) brightness(2)', opacity: 0 }, { transform: 'scale(1)', filter: 'blur(0) brightness(1)', opacity: 1 }], { duration: 1150, delay: 6200, easing: 'cubic-bezier(.16,.9,.25,1)' });
    tocar($('.tz__x'), [{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }], { duration: 700, delay: 6650, easing: 'cubic-bezier(.2,.8,.2,1)' });
    tocar($('.tz__beyond'), [{ transform: 'translateX(-18px)', filter: 'blur(10px)', opacity: 0 }, { transform: 'none', filter: 'blur(0)', opacity: 1 }], { duration: 1000, delay: 6800, easing: 'cubic-bezier(.2,.8,.2,1)' });
    tocar(R('titulo'), [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 7050 });
    tocar($('.tz__caps'), [{ letterSpacing: '.6em', opacity: 0, filter: 'blur(8px)' }, { letterSpacing: '.04em', opacity: 1, filter: 'blur(0)' }], { duration: 1100, delay: 7050, easing: 'cubic-bezier(.16,.9,.25,1)' });
    tocar($('.tz__script'), [{ clipPath: 'inset(-30% 100% -30% -10%)' }, { clipPath: 'inset(-30% -10% -30% -10%)' }], { duration: 900, delay: 7500, easing: 'cubic-bezier(.5,0,.2,1)' });
    sobe(R('breve'), 7900, 900, 8);
    try {
      for (const p of ['::before', '::after']) anims.push(R('breve').animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 900, delay: 8050, fill: 'both', easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: p }));
    } catch { /* navegador sem animação de ::before: as linhas já aparecem */ }
    sobe(R('sub'), 8250);
    sobe(R('acoes'), 8450);
    sobe(R('cue'), 8900, 900, -8);
    depois(8300, () => orbitar(false));
    depois(9400, () => { fim = true; tz.classList.add('is-done'); });
    // espera as imagens das cartas (escudos e fotos) antes de soltar a animação
    const vez = ++rodada;
    anims.forEach(a => a.pause());
    const imgs = [...ring.querySelectorAll('img')];
    Promise.race([
      Promise.all(imgs.map(i => (i.decode ? i.decode() : Promise.resolve()).catch(() => {}))),
      new Promise(r => setTimeout(r, 2500)),
    ]).then(() => { if (vez === rodada && !fim) anims.forEach(a => a.play()); });
  }

  /* ---------- final: cartas pequenas girando devagar em volta das logos ---------- */
  // (só em tela grande: no celular as cartas ficariam por cima das logos; lá o final fica limpo)
  function orbitar(direto) {
    orbita.forEach(a => a.cancel()); orbita = [];
    if (innerWidth < 900 || innerHeight < 560) return;
    const n = cartas.length;
    const dy = innerHeight * .02;
    const raio = Math.min(innerWidth * .44, 640);
    const s = .66;
    cartas.forEach((el, i) => {
      const phi = i * 360 / n;
      orbita.push(el.animate([
        { transform: T({ ry: phi, tz: raio * .2, s: 0 }) },
        { transform: T({ ry: phi, tz: raio, s }) },
      ], { duration: direto ? 1 : 1800, delay: direto ? 0 : i * 40, fill: 'both', easing: 'cubic-bezier(.2,.8,.2,1)' }));
    });
    orbita.push(ring.animate([
      { transform: `translateY(${dy.toFixed(0)}px) rotateX(-7deg) rotateY(0deg)` },
      { transform: `translateY(${dy.toFixed(0)}px) rotateX(-7deg) rotateY(-360deg)` },
    ], { duration: 90000, iterations: Infinity }));
    orbita.push(dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: direto ? 1 : 1600, fill: 'both' }));
  }

  function pular() {
    if (fim) return;
    eventos = [];
    anims.forEach(a => { try { a.finish(); } catch { /* já terminou */ } });
    faiscas = [];
    orbitar(true);
    fim = true; tz.classList.add('is-done');
  }
  function repetir() {
    rodada++;
    eventos = [];
    anims.forEach(a => a.cancel()); anims = [];
    orbita.forEach(a => a.cancel()); orbita = [];
    faiscas = [];
    rodar();
  }
  skipBtn.addEventListener('click', pular);
  replayBtn.addEventListener('click', repetir);
  addEventListener('keydown', e => { if (e.key === 'Escape') pular(); });
  // girou o celular ou mudou o tamanho da janela depois do final: refaz o carrossel do final
  let espera;
  addEventListener('resize', () => { clearTimeout(espera); espera = setTimeout(() => { if (fim) orbitar(true); }, 250); });

  rodar();
})();
