/* ============================================================
   VERSATTE CARDS · TEASER · SEÇÕES (rolando versatte-cards.html)
   - [data-carta="secao:n"]: recebe a carta n da seção (js/vitrine-cartas.js)
   - .rv e [data-revela]: sobem e aparecem quando entram na tela (os números [data-conta] contam)
   - [data-tilt3d]: a carta inclina e brilha seguindo o mouse/dedo
   - [data-scrub]: cena presa na tela; a rolagem dentro da seção conduz a animação (0 → 1):
       palavras  o texto acende palavra por palavra
       pacote    o pacote chega, treme, rasga, as cartas sobem, se espalham e viram
       clube     as cartas entram em campo e mudam de formação (2-1-1 → 1-2-1 → 1-1-2)
   Com "reduzir movimento" ligado no aparelho, tudo aparece pronto (no fim de cada cena).
   ============================================================ */
(() => {
  const V = window.VERSATTE_VITRINE;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const faixa = (p, a, b) => clamp((p - a) / (b - a));   // quanto de [a, b] já passou
  const suave = t => t * t * (3 - 2 * t);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ---------- cartas nos lugares ---------- */
  if (V) $$('[data-carta]').forEach(el => {
    const [secao, i] = el.dataset.carta.split(':');
    const uid = V.secoes?.[secao]?.[+i], html = uid && V.cartas[uid];
    if (html) el.insertAdjacentHTML('beforeend', html);
  });

  /* ---------- números que contam ---------- */
  const contar = raiz => $$('[data-conta]', raiz).forEach(el => {
    const fim = +el.dataset.conta;
    if (reduce || el.dataset.contou) { el.textContent = fim; return; }
    el.dataset.contou = '1';
    const t0 = performance.now(), dur = 1400;
    const passo = t => { const k = clamp((t - t0) / dur); el.textContent = Math.round(fim * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(passo); };
    el.textContent = '0';
    requestAnimationFrame(passo);
  });

  /* ---------- entra na tela ---------- */
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('is-in');
    contar(e.target);
    io.unobserve(e.target);
  }), { rootMargin: '0px 0px -14% 0px' });
  $$('.rv, [data-revela]').forEach(el => io.observe(el));

  /* ---------- inclinação 3D com brilho ---------- */
  $$('[data-tilt3d]').forEach(host => {
    const pos = (e, card) => {
      const r = card.getBoundingClientRect(), x = clamp((e.clientX - r.left) / r.width), y = clamp((e.clientY - r.top) / r.height);
      card.style.setProperty('--rx', `${((.5 - y) * 22).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${((x - .5) * 26).toFixed(2)}deg`);
      card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      card.style.setProperty('--hyp', Math.min(1, Math.hypot(x - .5, y - .5) * 2).toFixed(3));
    };
    host.addEventListener('pointermove', e => { const c = host.querySelector('.vcard'); if (!c) return; c.classList.add('is-tilting'); pos(e, c); });
    host.addEventListener('pointerleave', () => {
      const c = host.querySelector('.vcard'); if (!c) return;
      c.classList.remove('is-tilting');
      for (const [k, v] of [['--rx', '0deg'], ['--ry', '0deg'], ['--mx', '50%'], ['--my', '50%'], ['--hyp', '0']]) c.style.setProperty(k, v);
    });
  });

  /* ---------- cenas conduzidas pela rolagem ---------- */
  const CENAS = {
    palavras(el) {
      const box = el.querySelector('[data-palavras]');
      const ACENTO = /^(cartas|álbuns|clube|campeonatos|versatte)/i;
      const palavras = box.textContent.trim().split(/\s+/);
      box.textContent = '';
      const spans = palavras.map(w => {
        const s = document.createElement('span');
        s.className = 'tzs-w' + (ACENTO.test(w) ? ' tzs-w--acento' : '');
        s.textContent = w;
        box.append(s, ' ');
        return s;
      });
      return p => {
        const aceso = faixa(p, .06, .78) * (spans.length + 2);
        spans.forEach((s, i) => {
          const o = clamp(aceso - i);
          const v = (.14 + o * .86).toFixed(2);
          if (s._v !== v) { s._v = v; s.style.opacity = v; s.classList.toggle('is-on', o > .6); }
        });
      };
    },

    pacote(el) {
      const palco = el.querySelector('[data-pacote]');
      const frente = palco.querySelector('.tzs-pk--frente'), fundo = palco.querySelector('.tzs-pk--fundo'), tampa = palco.querySelector('.tzs-pk--tampa');
      const luz = palco.querySelector('.tzs-pacote__luz'), cartas = $$('.tzs-pc', palco), passos = $$('[data-passo]', el);
      return p => {
        const H = palco.clientHeight, cw = cartas[0].offsetWidth, ch = cw * 88 / 63, pequeno = innerWidth < 900;
        const entra = suave(faixa(p, 0, .13)), treme = faixa(p, .13, .3), rasga = suave(faixa(p, .3, .4)), cai = suave(faixa(p, .5, .66));
        const tremor = treme > 0 && treme < 1 ? Math.sin(p * 1400) * 3.2 * treme : 0;
        const pk = `translateY(${((1 - entra) * 90 + cai * H * .5).toFixed(1)}px) rotate(${tremor.toFixed(2)}deg) scale(${(.84 + entra * .16).toFixed(3)})`;
        for (const el2 of [frente, fundo]) { el2.style.transform = pk; el2.style.opacity = (entra * (1 - cai)).toFixed(3); }
        frente.style.clipPath = `inset(${(rasga * 17).toFixed(2)}% -2px -2px -2px)`;
        tampa.style.transform = `translateY(${((1 - entra) * 90 - rasga * 120).toFixed(1)}px) translateX(${(rasga * 40).toFixed(1)}px) rotate(${(tremor - rasga * 22).toFixed(2)}deg) scale(${(.84 + entra * .16).toFixed(3)})`;
        tampa.style.opacity = (entra * (1 - faixa(p, .36, .46))).toFixed(3);
        luz.style.opacity = (treme * .5 + rasga * .5 - faixa(p, .6, .9) * .55).toFixed(3);
        // cartas: dentro do pacote → sobem → se espalham → viram
        const yPacote = H * (pequeno ? .66 : .64);
        cartas.forEach((c, i) => {
          const sobe = suave(faixa(p, .36 + i * .025, .52 + i * .025)), abre = suave(faixa(p, .52 + i * .02, .7 + i * .02));
          const f = suave(faixa(p, .72 + i * .05, .8 + i * .05));
          const x0 = 0, y0 = ch * .08 - (1 - entra) * -90;
          const x1 = (i - 1.5) * cw * .18, y1 = -ch * .9;
          const [x2, y2] = pequeno
            ? [((i % 2) - .5) * cw * 1.1, H * .4 + (Math.floor(i / 2) - .5) * ch * 1.06 - yPacote]
            : [(i - 1.5) * cw * 1.13, H * .38 - yPacote];
          const xa = x0 + (x1 - x0) * sobe, ya = y0 + (y1 - y0) * sobe + cai * 0;
          const x = xa + (x2 - xa) * abre, y = ya + (y2 - ya) * abre;
          const rot = (i - 1.5) * 7 * sobe * (1 - abre);
          c.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${(.9 + .1 * sobe).toFixed(3)})`;
          c.style.setProperty('--f', f.toFixed(3));
          if (i === cartas.length - 1) c.style.setProperty('--g', (f * (1 - .45 * faixa(p, .94, 1))).toFixed(3));
        });
        const ativo = p < .34 ? 0 : p < .7 ? 1 : 2;
        passos.forEach((li, i) => li.classList.toggle('is-on', i === ativo));
      };
    },

    clube(el) {
      const jog = $$('.tzs-jog', el), formas = $$('[data-forma]', el);
      // posições no campo (x %, y %): goleiro, zagueiro, volante, meia, atacante
      const F = [
        [[50, 98], [31, 75], [69, 75], [50, 52], [50, 29]],   // 2-1-1 defensiva
        [[50, 98], [50, 75], [27, 52], [73, 52], [50, 29]],   // 1-2-1 equilibrada
        [[50, 98], [50, 75], [50, 52], [30, 29], [70, 29]],   // 1-1-2 ofensiva
      ];
      return p => {
        const m1 = suave(faixa(p, .42, .54)), m2 = suave(faixa(p, .7, .82));
        jog.forEach((j, i) => {
          const [a, b, c] = F.map(f => f[i]);
          let x = a[0] + (b[0] - a[0]) * m1 + (c[0] - b[0]) * m2, y = a[1] + (b[1] - a[1]) * m1 + (c[1] - b[1]) * m2;
          const e = suave(faixa(p, .02 + i * .05, .2 + i * .05));
          x = 112 + (x - 112) * e; y = 104 + (y - 104) * e;   // saem do baralho, no canto do campo
          j.style.left = `${x.toFixed(2)}%`; j.style.top = `${y.toFixed(2)}%`;
          j.style.setProperty('--e', e.toFixed(3));
          j.style.zIndex = Math.round(y);
        });
        const ativa = p < .48 ? 0 : p < .76 ? 1 : 2;
        formas.forEach((s, i) => s.classList.toggle('is-on', i === ativa));
      };
    },
  };

  const cenas = $$('[data-scrub]').map(el => ({ el, rodar: CENAS[el.dataset.scrub]?.(el) })).filter(c => c.rodar);
  const atualizar = () => {
    for (const { el, rodar } of cenas) {
      const r = el.getBoundingClientRect(), total = r.height - innerHeight;
      rodar(reduce ? 1 : total > 0 ? clamp(-r.top / total) : 1);
    }
  };
  let pedido = false;
  const agendar = () => { if (!pedido) { pedido = true; requestAnimationFrame(() => { pedido = false; atualizar(); }); } };
  addEventListener('scroll', agendar, { passive: true });
  addEventListener('resize', agendar);
  atualizar();
})();
