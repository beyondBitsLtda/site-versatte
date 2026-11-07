/* ============================================================
   VERSATTE SPORTS · comportamento da vitrine
   ============================================================ */
(() => {
  const root = document.documentElement;
  root.classList.remove('no-js');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // endereço sem ".html": o GitHub Pages abre /catalogo direto, então links antigos
  // (ex.: /catalogo.html#camisa-123) só trocam o texto na barra do navegador, sem recarregar
  if (/\.html$/.test(location.pathname)) history.replaceState(null, '', location.pathname.replace(/(index)?\.html$/, '') + location.search + location.hash);

  const WA_NUMBER = '553193168184';
  const IG_USER = 'versatte_sports';
  const SITE_URL = 'https://versattesports.com.br/';   // vai na mensagem do pedido do catálogo
  const dateBR = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' }) : '';
  const brl = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  // camisas da galeria, por grupo (gerado de camisas.json por tools/instagram.mjs)
  const GRUPOS = window.VERSATTE_CAMISAS || (window.VERSATTE_POSTS ? [{ grupo: '', camisas: window.VERSATTE_POSTS }] : []);
  const POSTS = GRUPOS.flatMap(g => g.camisas);
  const postUrl = code => `https://www.instagram.com/p/${code}/`;
  const waLink = text => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;
  // o Instagram não documenta texto pronto no ig.me; mandamos ?text= mesmo assim e copiamos a mensagem
  const dmLink = text => `https://ig.me/m/${IG_USER}?text=${encodeURIComponent(text)}`;

  /* ---------- nav ---------- */
  const nav = $('[data-nav]');
  const toggle = $('[data-menu-toggle]');
  const onScroll = () => nav.classList.toggle('is-scrolled', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const setMenu = open => {
    nav.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  };
  toggle.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  $$('#menu a').forEach(a => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
  matchMedia('(min-width: 1200px)').addEventListener('change', () => setMenu(false));

  /* ---------- hero / slider ---------- */
  const hero = $('[data-hero]');
  if (hero) {
    const DURATION = 7000;
    const now = new Date();
    // campanhas com data-until somem sozinhas depois do último dia (horário de Brasília)
    const slides = $$('[data-slide]', hero).filter(s => {
      if (s.hidden) { s.remove(); return false; }   // slide escondido (ex.: Versatte Cards por enquanto)
      const until = s.dataset.until;
      if (until && now > new Date(`${until}T23:59:59-03:00`)) { s.remove(); return false; }
      return true;
    });
    const dotsBox = $('[data-hero-dots]', hero);
    const pad = n => String(n).padStart(2, '0');
    $('[data-hero-total]', hero).textContent = pad(slides.length);
    const dots = slides.map((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hero__dot';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', `Slide ${i + 1}: ${s.dataset.label}`);
      b.style.setProperty('--dur', `${DURATION}ms`);
      b.addEventListener('click', () => go(i));
      dotsBox.appendChild(b);
      s.setAttribute('aria-label', `${i + 1} de ${slides.length}: ${s.dataset.label}`);
      return b;
    });

    let current = -1;
    const autoplay = !reduceMotion && slides.length > 1;
    function go(n) {
      n = (n + slides.length) % slides.length;
      if (n === current) return;
      current = n;
      slides.forEach((s, i) => {
        const on = i === n;
        s.classList.toggle('is-active', on);
        s.inert = !on;
        s.setAttribute('aria-hidden', String(!on));
        const img = $('.slide__media img', s);
        if (on && img && img.loading === 'lazy') img.loading = 'eager';
      });
      dots.forEach((d, i) => { d.classList.remove('is-active'); d.setAttribute('aria-selected', String(i === n)); });
      void dotsBox.offsetWidth; // reinicia a animação do indicador
      dots[n].classList.add('is-active');
      $('[data-hero-current]', hero).textContent = pad(n + 1);
    }
    // o fim da animação do indicador avança o slide (pausar o indicador pausa o slider)
    dotsBox.addEventListener('animationend', e => { if (autoplay && e.target === dots[current]) go(current + 1); });

    const pauseReasons = new Set();
    const pause = (why, on) => {
      on ? pauseReasons.add(why) : pauseReasons.delete(why);
      hero.classList.toggle('is-paused', pauseReasons.size > 0 || !autoplay);
    };
    hero.addEventListener('mouseenter', () => pause('hover', true));
    hero.addEventListener('mouseleave', () => pause('hover', false));
    hero.addEventListener('focusin', () => pause('focus', true));
    hero.addEventListener('focusout', e => { if (!hero.contains(e.relatedTarget)) pause('focus', false); });
    document.addEventListener('visibilitychange', () => pause('tab', document.hidden));
    new IntersectionObserver(([e]) => pause('offscreen', !e.isIntersecting), { threshold: .2 }).observe(hero);

    $('[data-hero-prev]', hero).addEventListener('click', () => go(current - 1));
    $('[data-hero-next]', hero).addEventListener('click', () => go(current + 1));
    hero.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') go(current - 1);
      if (e.key === 'ArrowRight') go(current + 1);
    });
    swipe(hero, dir => go(current + dir), el => el.closest('[data-tilt]'));
    pause('init', false);
    go(0);
  }

  // o WhatsApp flutuante aparece só depois do topo (slider da home ou topo do catálogo),
  // para não cobrir os botões de lá
  const topo = $('.hero');
  if (topo) new IntersectionObserver(([e]) => document.body.classList.toggle('past-hero', !e.isIntersecting), { threshold: .35 }).observe(topo);
  else document.body.classList.add('past-hero');

  /* ---------- borda do hero + faixa de tecido que corre pela curva ---------- */
  const edge = $('[data-edge]');
  if (edge && document.fonts) {
    const SVGNS = 'http://www.w3.org/2000/svg';
    const UNIT = '<tspan>Torcedor</tspan><tspan class="d"> • </tspan><tspan class="s">Jogador</tspan><tspan class="d"> • </tspan><tspan>Retrô</tspan><tspan class="d"> • </tspan><tspan class="s">Clubes &amp; Seleções</tspan><tspan class="d"> • </tspan><tspan>@versatte_sports</tspan><tspan class="d"> • </tspan>';
    let textPath = null, unitLen = 0, offset = 0, lastW = 0, visible = true;

    const build = () => {
      const W = edge.clientWidth, box = edge.clientHeight;
      if (!W || W === lastW) return;
      lastW = W;
      const big = W >= 1000;
      const up = big ? 50 : 40;               // folga acima da curva para a faixa (igual ao --edge-up do CSS)
      const H = box - up;                      // altura da curva
      const T = big ? 56 : 40;                 // largura da faixa
      const fs = big ? 31 : 22;                // tamanho do texto
      // mesma curva da borda: começa em H/2 nas laterais e encosta no topo no centro
      const c = `C${W / 6} ${H * .075}, ${W / 3} 0, ${W / 2} 0 S${(W * 5) / 6} ${H * .075}, ${W} ${H / 2}`;
      const fill = `M0 ${H / 2} ${c} V${H + 2} H0 Z`;
      const line = `M-80 ${H / 2 + H * .12} L0 ${H / 2} ${c} L${W + 80} ${H / 2 + H * .12}`;
      const shift = dy => `transform="translate(0 ${dy})"`;
      const svg = $('.edge__svg', edge);
      svg.removeAttribute('preserveAspectRatio');
      svg.setAttribute('viewBox', `0 ${-up} ${W} ${box}`);
      svg.innerHTML = `
        <defs>
          <filter id="rb-shadow" x="-10%" y="-200%" width="120%" height="500%"><feGaussianBlur stdDeviation="7"/></filter>
          <filter id="rb-fabric" x="-5%" y="-200%" width="110%" height="500%">
            <feTurbulence type="fractalNoise" baseFrequency="1.4 .09" numOctaves="2" seed="8" result="n"/>
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 .22  0 0 0 0 .07  0 0 0 0 0  0 0 0 -1.2 .78" result="weave"/>
            <feComposite in="weave" in2="SourceAlpha" operator="in" result="tex"/>
            <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="tex"/></feMerge>
          </filter>
          <mask id="rb-mask" maskUnits="userSpaceOnUse" x="-100" y="-200" width="${W + 200}" height="${H + 400}"><path d="${line}" ${shift(4)} fill="none" stroke="#fff" stroke-width="${T}"/></mask>
          <path id="rb-line" d="${line}" ${shift(4)}/>
        </defs>
        <path class="edge__fill" d="${fill}"/>
        <path d="${line}" ${shift(4 + T * .22)} fill="none" stroke="rgba(70,28,4,.38)" stroke-width="${T * .9}" filter="url(#rb-shadow)"/>
        <g mask="url(#rb-mask)" filter="url(#rb-fabric)">
          <path d="${line}" ${shift(4)} fill="none" stroke="#E5580D" stroke-width="${T}"/>
          <path d="${line}" ${shift(4 - T * .3)} fill="none" stroke="#FF9550" stroke-opacity=".6" stroke-width="${T * .34}"/>
          <path d="${line}" ${shift(4 + T * .36)} fill="none" stroke="#A33605" stroke-opacity=".6" stroke-width="${T * .3}"/>
        </g>
        <path d="${line}" ${shift(4 - T / 2 + 5)} fill="none" stroke="rgba(255,236,214,.8)" stroke-width="1.4" stroke-dasharray="7 5"/>
        <path d="${line}" ${shift(4 + T / 2 - 5)} fill="none" stroke="rgba(255,236,214,.8)" stroke-width="1.4" stroke-dasharray="7 5"/>
        <text class="ribbon__text" font-size="${fs}" dominant-baseline="central"><textPath href="#rb-line" startOffset="0"></textPath></text>`;
      // mede o comprimento de uma volta do texto e repete o suficiente para cobrir a curva
      const probe = document.createElementNS(SVGNS, 'text');
      probe.setAttribute('class', 'ribbon__text');
      probe.setAttribute('font-size', fs);
      probe.innerHTML = UNIT;
      svg.appendChild(probe);
      unitLen = probe.getComputedTextLength() || 600;
      probe.remove();
      const pathLen = $('#rb-line', svg).getTotalLength();
      textPath = $('textPath', svg);
      textPath.innerHTML = UNIT.repeat(Math.ceil(pathLen / unitLen) + 2);
      offset %= unitLen;
      textPath.setAttribute('startOffset', offset);
    };

    document.fonts.ready.then(() => {
      build();
      let t;
      new ResizeObserver(() => { clearTimeout(t); t = setTimeout(build, 120); }).observe(edge);
      if (reduceMotion) return;
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(edge);
      let prev = performance.now();
      const tick = now => {
        const dt = Math.min(64, now - prev); prev = now;
        if (visible && textPath && unitLen) {
          offset -= dt * .045;                 // ~45 px/s
          if (offset <= -unitLen) offset += unitLen;
          textPath.setAttribute('startOffset', offset.toFixed(1));
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // gesto de arrastar para o lado (celular)
  function swipe(el, onSwipe, ignore = () => false) {
    let sx = 0, sy = 0, on = false;
    el.addEventListener('touchstart', e => {
      if (ignore(e.target)) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true;
    }, { passive: true });
    el.addEventListener('touchend', e => {
      if (!on) return;
      on = false;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.3) onSwipe(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  /* ---------- modais ---------- */
  let lastFocus = null;
  // de um modal para outro (ex.: camisa -> pedido), o foco volta para quem abriu o primeiro
  const openModal = dlg => {
    if (!document.activeElement?.closest('dialog')) lastFocus = document.activeElement;
    document.body.classList.add('modal-open');
    dlg.showModal();
  };
  const closedModal = () => { if (!$('dialog[open]')) document.body.classList.remove('modal-open'); };

  /* ---------- mensagens ---------- */
  const messageFor = (post, extra = '') => {
    if (!post) return 'Olá! Vi o site da Versatte Sports e quero comprar uma camisa.';
    if (post.msg) return `Olá! ${post.msg}${extra} ${postUrl(post.code)}`;
    return `Olá! Vi no site da Versatte e tenho interesse na camisa ${post.name || 'deste post'}${extra}. ${postUrl(post.code)}`;
  };

  const toastEl = $('[data-toast]');
  let toastTimer;
  const toast = text => {
    toastEl.textContent = text;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 4200);
  };
  // Copia de forma SÍNCRONA, ainda dentro do clique. Se a cópia esperar, o navegador já abriu
  // o Direct em outra aba/app, a página perde o foco e a área de transferência é bloqueada.
  const copyNow = text => {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).catch(() => {});
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    // com um modal aberto, o resto da página fica inerte: o campo precisa ir para dentro dele
    ($('dialog[open]') || document.body).appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  };
  const copy = async text => { try { await navigator.clipboard.writeText(text); return true; } catch { return copyNow(text); } };

  /* ---------- Direct: copia a mensagem e mostra como colar ---------- */
  const dmtip = $('[data-dmtip]');
  const touch = matchMedia('(pointer: coarse)').matches;
  let dmText = '';
  const setDmTipState = ok => {
    dmtip.classList.toggle('is-fail', !ok);
    $('[data-dmtip-title]', dmtip).textContent = ok ? 'Mensagem copiada!' : 'Quase lá!';
    $('[data-dmtip-text]', dmtip).innerHTML = ok
      ? `O Instagram não deixa sites escreverem no Direct, então a gente já copiou para você. Abra o Direct e ${touch ? '<b>toque e segure</b> no campo de mensagem e escolha <b>Colar</b>' : 'cole no campo de mensagem com <b>Ctrl+V</b>'}.`
      : 'Seu navegador não deixou copiar sozinho. Selecione a mensagem abaixo, copie e cole no Direct, ou envie pelo WhatsApp, que já vai escrita.';
  };
  const openDmTip = text => {
    dmText = text;
    const ok = copyNow(text);
    $('[data-dmtip-msg]', dmtip).textContent = text;
    $('[data-dmtip-open]', dmtip).href = dmLink(text);
    $('[data-dmtip-wa]', dmtip).href = waLink(text);
    setDmTipState(ok);
    if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).then(() => setDmTipState(true), () => {});
    $$('dialog[open]').forEach(d => { if (d !== dmtip) d.close(); });
    openModal(dmtip);
  };
  // ao abrir o Direct, copia de novo no mesmo clique (garantia) e fecha o aviso
  $('[data-dmtip-open]', dmtip).addEventListener('click', () => { copyNow(dmText); setTimeout(() => dmtip.close(), 400); });
  $('[data-dmtip-wa]', dmtip).addEventListener('click', () => setTimeout(() => dmtip.close(), 400));
  $('[data-dmtip-close]', dmtip).addEventListener('click', () => dmtip.close());
  dmtip.addEventListener('click', e => { if (e.target === dmtip) dmtip.close(); });
  dmtip.addEventListener('close', () => { closedModal(); if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true }); });

  // links de WhatsApp com mensagem pronta definida no HTML
  $$('a[data-wa-msg]').forEach(a => { a.href = waLink(`Olá! ${a.dataset.waMsg}`); });

  // links de direct do site (topo, hero, guia, rodapé)
  $$('a[data-dm]').forEach(a => {
    const text = a.dataset.dm ? `Olá! ${a.dataset.dm}` : messageFor(null);
    a.href = dmLink(text);
    a.addEventListener('click', e => { e.preventDefault(); setMenu(false); openDmTip(text); });
  });

  /* ---------- formulário de contato (FormSubmit) ----------
     Envia para o e-mail configurado em data-endpoint, no index.html. */
  const contato = $('[data-contact]');
  if (contato) {
    const status = $('[data-contact-status]', contato);
    const enviar = $('[data-contact-send]', contato);
    const avisar = (texto, tipo = '') => { status.textContent = texto; status.className = `contact__status${tipo ? ` is-${tipo}` : ''}`; };
    contato.addEventListener('input', e => e.target.closest('.field')?.classList.remove('is-invalid'));
    contato.addEventListener('submit', async e => {
      e.preventDefault();
      const obrigatorios = [...contato.querySelectorAll('input[required], textarea[required]')];
      const invalidos = obrigatorios.filter(c => !c.value.trim() || !c.checkValidity());
      obrigatorios.forEach(c => c.closest('.field').classList.toggle('is-invalid', invalidos.includes(c)));
      if (invalidos.length) {
        const emailErrado = invalidos.some(c => c.type === 'email' && c.value.trim());
        avisar(emailErrado ? 'Confira o e-mail digitado.' : 'Preencha nome, e-mail e mensagem.', 'err');
        invalidos[0].focus();
        return;
      }
      const dados = Object.fromEntries(new FormData(contato));
      if (dados.botcheck) return; // robô marcou o campo escondido
      const endpoint = contato.dataset.endpoint;
      if (!endpoint) { avisar('O formulário ainda está sendo configurado. Por enquanto, fale com a gente pelo Direct ou pelo WhatsApp.', 'err'); return; }
      enviar.disabled = true;
      enviar.textContent = 'Enviando…';
      avisar('');
      try {
        // FormData (não JSON): evita a verificação prévia (preflight) do navegador
        const envio = new FormData();
        envio.append('_subject', `Contato pelo site · ${dados.name.trim()}`);
        envio.append('_template', 'table');
        envio.append('_captcha', 'false');
        envio.append('Nome', dados.name.trim());
        envio.append('email', dados.email.trim());               // vira o "responder para"
        envio.append('WhatsApp', (dados.whatsapp || '').trim() || 'não informado');
        envio.append('Mensagem', dados.message.trim());
        const r = await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: envio });
        const resposta = await r.json().catch(() => ({}));
        const ok = resposta.success === true || resposta.success === 'true';
        if (!r.ok || !ok) throw new Error(resposta.message || `HTTP ${r.status}`);
        contato.reset();
        avisar('Mensagem enviada! A gente responde no seu e-mail em breve.', 'ok');
      } catch (erro) {
        console.warn('Formulário de contato:', erro.message);
        avisar('Não foi possível enviar agora. Tente de novo ou fale com a gente pelo WhatsApp.', 'err');
      } finally {
        enviar.disabled = false;
        enviar.textContent = 'Enviar mensagem';
      }
    });
  }

  /* ---------- novidades do Insta (a partir de js/posts.js) ---------- */
  // primeira linha da legenda, sem hashtags (para posts sem título próprio no camisas.json)
  const resumo = text => {
    const linha = String(text || '').replace(/#[\p{L}\p{N}_]+/gu, '').split('\n').map(s => s.trim()).find(Boolean) || '';
    return linha.length > 120 ? `${linha.slice(0, 117).trimEnd()}…` : linha;
  };
  const shop = $('[data-shop]');
  if (shop) {
    let i = -1;
    const cardHTMLDaCamisa = p => {
      i++;
      const imgs = (p.thumbs || p.images || []).slice(0, 2);
      const total = (p.images || []).length;
      const alt = p.name || resumo(p.caption) || 'Post da Versatte';
      return `
      <li class="post reveal" data-index="${i}">
        <button class="post__media" type="button" data-open-post aria-label="Ver o post completo: ${esc(alt)}">
          ${imgs.map((src, k) => `<img src="${esc(src)}" alt="${k ? '' : esc(alt)}" loading="lazy" decoding="async" width="1080" height="1350">`).join('')}
          ${p.video ? '<span class="post__count"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-play"/></svg>Reels</span>'
            : total > 1 ? `<span class="post__count"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-stack"/></svg>${total}</span>` : ''}
        </button>
        <div class="post__body">
          <span class="post__tag">${esc(p.tag || (p.date ? `Postado em ${dateBR(p.date)}` : 'Novidade'))}</span>
          ${p.caps ? `<h3 class="post__title"><span>${esc(p.caps)}</span><em>${esc(p.script)}</em></h3>`
            : `<p class="post__excerpt">${esc(resumo(p.caption))}</p>`}
          <div class="post__buy">
            <button class="btn btn--solid btn--sm" type="button" data-order-open>${p.msg ? 'Me ajuda a escolher' : 'Quero essa'}</button>
            <button class="btn btn--line btn--sm" type="button" data-open-post>Ver post</button>
          </div>
        </div>
      </li>`;
    };
    // com mais de um grupo, cada grupo ganha um título próprio dentro da galeria
    shop.innerHTML = GRUPOS.map(g => (GRUPOS.length > 1 && g.grupo ? `<li class="shop__group"><h3>${esc(g.grupo)}</h3></li>` : '')
      + g.camisas.map(cardHTMLDaCamisa).join('')).join('');
  }
  const postOf = el => {
    const code = el.closest('[data-code]')?.dataset.code;
    return code ? POSTS.find(p => p.code === code) : POSTS[+el.closest('[data-index]')?.dataset.index];
  };

  // carrossel de fotos dos modais (prévia do post e camisa do catálogo); devolve a função que troca as fotos
  const carrossel = box => {
    const track = $('.ig__track', box), dots = $('.ig__dots', box);
    const prev = $('.ig__arrow--prev', box), next = $('.ig__arrow--next', box);
    let atual = 0;
    const show = n => {
      const count = track.children.length;
      atual = Math.max(0, Math.min(count - 1, n));
      track.style.transform = `translateX(${-atual * 100}%)`;
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i === atual));
      prev.hidden = atual === 0;
      next.hidden = atual >= count - 1;
    };
    prev.addEventListener('click', () => show(atual - 1));
    next.addEventListener('click', () => show(atual + 1));
    swipe($('.ig__media', box), dir => show(atual + dir));
    box.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') show(atual - 1);
      if (e.key === 'ArrowRight') show(atual + 1);
    });
    return (imgs, alt) => {
      track.innerHTML = imgs.map((src, i) => `<img src="${esc(src)}" alt="${esc(alt)}, foto ${i + 1} de ${imgs.length}" ${i ? 'loading="lazy"' : ''} decoding="async" draggable="false">`).join('');
      dots.innerHTML = imgs.length > 1 ? imgs.map(() => '<i></i>').join('') : '';
      show(0);
    };
  };

  /* ---------- prévia no formato do Instagram (só na home) ---------- */
  const viewer = $('[data-viewer]');
  let viewerPost = null, openViewer = () => {};

  const linkify = text => esc(text)
    .replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, '$1<a href="https://www.instagram.com/explore/tags/$2/" target="_blank" rel="noopener">#$2</a>')
    .replace(/(^|[\s(])@([A-Za-z0-9._]+[A-Za-z0-9_])/g, '$1<a href="https://www.instagram.com/$2/" target="_blank" rel="noopener">@$2</a>');

  if (viewer) {
    const viewerFotos = carrossel(viewer);
    openViewer = post => {
      viewerPost = post;
      viewerFotos(post.images || [], post.name || 'Post da Versatte');
      $('[data-ig-name]', viewer).textContent = post.name || dateBR(post.date);
      $('[data-ig-caption]', viewer).innerHTML = linkify(post.caption || '');
      const date = $('[data-ig-date]', viewer);
      date.textContent = dateBR(post.date);
      date.dateTime = post.date || '';
      $('[data-ig-likes]', viewer).textContent = post.likes ? `${post.likes} curtida${post.likes > 1 ? 's' : ''}` : '';
      const url = postUrl(post.code);
      // sem o número de comentários (o feed nem sempre traz), só leva ao post
      $('[data-ig-comments]', viewer).innerHTML = post.comments == null
        ? `<a href="${url}" target="_blank" rel="noopener">Ver os comentários no Instagram →</a>`
        : post.comments
          ? `<a href="${url}" target="_blank" rel="noopener">Ver ${post.comments === 1 ? 'o comentário' : `os ${post.comments} comentários`} no Instagram →</a>`
          : `Ainda não há comentários. <a href="${url}" target="_blank" rel="noopener">Seja o primeiro no Instagram →</a>`;
      $$('[data-ig-link]', viewer).forEach(a => { a.href = url; });
      $('[data-ig-wa]', viewer).href = waLink(messageFor(post));
      $('[data-order-open]', viewer).textContent = post.msg ? 'Me ajuda a escolher' : 'Quero essa camisa';
      $('.ig__box', viewer).scrollTop = 0;
      $('.ig__scroll', viewer).scrollTop = 0;
      openModal(viewer);
    };

    $('[data-viewer-close]', viewer).addEventListener('click', () => viewer.close());
    viewer.addEventListener('click', e => { if (e.target === viewer) viewer.close(); }); // clique fora fecha
    viewer.addEventListener('close', () => {
      closedModal();
      if (lastFocus && !order.open) lastFocus.focus({ preventScroll: true });
    });
    $('[data-ig-share]', viewer).addEventListener('click', async () => {
      const url = postUrl(viewerPost.code);
      if (navigator.share) { try { await navigator.share({ title: viewerPost.name, url }); return; } catch { return; } }
      toast(await copy(url) ? 'Link do post copiado!' : url);
    });
  }

  /* ---------- catálogo: dados (js/catalogo.js, gerado por tools/catalogo.mjs) ---------- */
  const CAT = window.VERSATTE_CATALOGO || { modelos: [], camisas: [] };
  const MODELOS = [...CAT.modelos].sort((a, b) => a.preco - b.preco);   // abas do mais barato ao mais caro
  const TAMANHOS = CAT.tamanhos || ['P', 'M', 'G', 'GG', '2XL', '3XL', '4XL'];
  const modeloDe = c => MODELOS.find(m => m.id === c.modelo) || { nome: c.modelo, preco: 0 };
  const doCatalogo = item => Boolean(item && item.modelo && item.capa);
  const CATALOGO_URL = `${SITE_URL}catalogo`;
  const camisaUrl = c => `${CATALOGO_URL}#camisa-${c.id}`;
  const mensagemCatalogo = (c, tamanho = '') => {
    const m = modeloDe(c);
    return `Olá! Vi no catálogo do site da Versatte e quero a camisa ${c.nome} (modelo ${m.nome}${tamanho ? `, tamanho ${tamanho}` : ''}, ${brl(m.preco)}). Cód. ${c.id} ${camisaUrl(c)}`;
  };

  /* ---------- "Quero essa camisa": monta a mensagem ---------- */
  const order = $('[data-order]');
  const form = $('[data-order-form]', order);
  const msgBox = $('[data-order-msg]', order);
  let orderPost = null, edited = false;

  const composeOrder = () => {
    const modelo = form.modelo.value, tamanho = form.tamanho.value;
    if (doCatalogo(orderPost)) return mensagemCatalogo(orderPost, tamanho);
    const extra = [modelo && `modelo ${modelo}`, tamanho && `tamanho ${tamanho}`].filter(Boolean).join(', ');
    return messageFor(orderPost, extra ? ` (${extra})` : '');
  };
  const syncOrder = () => {
    if (!edited) msgBox.value = composeOrder();
    $('[data-order-wa]', order).href = waLink(msgBox.value);
    $('[data-order-dm]', order).href = dmLink(msgBox.value);
  };
  // post do Instagram ou camisa do catálogo (essa já tem modelo e preço, então some a escolha de modelo)
  const openOrder = post => {
    orderPost = post;
    edited = false;
    form.reset();
    const cat = doCatalogo(post);
    const nome = post.nome || post.name || 'Camisa do post';
    $('[data-order-name]', order).textContent = nome;
    $('[data-chips="modelo"]', order).hidden = cat;
    const preco = $('[data-order-price]', order);
    preco.hidden = !cat;
    if (cat) preco.textContent = `Modelo ${modeloDe(post).nome} · ${brl(modeloDe(post).preco)}`;
    const thumb = $('[data-order-thumb]', order);
    thumb.src = cat ? post.capa : (post.thumbs || post.images || [])[0] || '';
    thumb.alt = nome;
    syncOrder();
    if (viewer?.open) viewer.close();
    if (product.open) product.close();
    openModal(order);
    document.dispatchEvent(new CustomEvent('vs:pedido', { detail: post }));   // a loja (js/loja.js) escuta
  };
  // cada modelo tem uma faixa de tamanhos (ver seção "Tabela de medidas");
  // no catálogo vale a faixa da própria camisa, lida do título
  const SIZE_MAX = { Torcedor: '4XL', Jogador: '3XL', Feminina: 'GG' };
  const sizeInputs = [...form.querySelectorAll('input[name=tamanho]')];
  const limitSizes = () => {
    const max = doCatalogo(orderPost) ? orderPost.max || SIZE_MAX[modeloDe(orderPost).nome] : SIZE_MAX[form.modelo.value];
    const last = max ? sizeInputs.findIndex(i => i.value === max) : sizeInputs.length - 1;
    sizeInputs.forEach((input, i) => {
      input.disabled = i > last;
      if (input.disabled && input.checked) input.checked = false;
    });
  };
  form.addEventListener('change', e => { if (e.target.name === 'modelo') limitSizes(); syncOrder(); });
  form.addEventListener('reset', () => setTimeout(limitSizes));
  $('[data-to-sizes]', order).addEventListener('click', () => order.close());
  msgBox.addEventListener('input', () => { edited = true; syncOrder(); });
  $('[data-order-dm]', order).addEventListener('click', e => { e.preventDefault(); openDmTip(msgBox.value); });
  order.addEventListener('click', e => { if (e.target === order) order.close(); });
  order.addEventListener('close', () => { closedModal(); if (lastFocus) lastFocus.focus({ preventScroll: true }); });

  /* ---------- camisa do catálogo: fotos, preço e pedido ---------- */
  const product = $('[data-product]');
  const productFotos = carrossel(product);
  let productItem = null;
  const faixa = c => `${TAMANHOS[0]} ao ${c.max || SIZE_MAX[modeloDe(c).nome] || TAMANHOS.at(-1)}`;
  const openProduct = c => {
    productItem = c;
    const m = modeloDe(c);
    productFotos(c.fotos, c.nome);
    $('[data-prod-model]', product).textContent = `Modelo ${m.nome}`;
    $('[data-prod-tag]', product).textContent = `Modelo ${m.nome}`;
    $('[data-prod-team]', product).textContent = c.time;
    $('[data-prod-detail]', product).textContent = c.detalhe;
    $('[data-prod-price]', product).innerHTML = `<small>R$</small>${esc(brl(m.preco).replace(/^R\$\s*/, ''))}`;
    $('[data-prod-sizes]', product).textContent = faixa(c);
    $('[data-prod-code]', product).textContent = c.id;
    $('[data-prod-wa]', product).href = waLink(mensagemCatalogo(c));
    $('.ig__box', product).scrollTop = 0;
    openModal(product);
  };
  $('[data-product-close]', product).addEventListener('click', () => product.close());
  $('[data-prod-guide]', product).addEventListener('click', () => product.close());
  product.addEventListener('click', e => { if (e.target === product) product.close(); });
  product.addEventListener('close', () => {
    closedModal();
    // tira o #camisa-... do endereço, para o mesmo link poder abrir a camisa de novo
    // (no catálogo completo o endereço volta para a aba aberta, ex.: #retro)
    if (/^#camisa-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + (catGrid ? `#${cat.modelo}` : ''));
    if (lastFocus && !order.open) lastFocus.focus({ preventScroll: true });
  });

  /* ---------- catálogo: cards (destaques da home e catálogo completo) ---------- */
  const POR_PAGINA = 24;   // catálogo completo: camisas por vez ("Ver mais camisas")
  const DESTAQUES = 8;     // home: camisas em destaque
  // frase de cada modelo nos atalhos da home (o id é o do catalogo.json)
  const FRASE_MODELO = { torcedor: 'Escudo bordado e conforto pro dia a dia', jogador: 'A mesma tecnologia usada em campo', retro: 'Os clássicos que marcaram época' };
  const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  CAT.camisas.forEach(c => { c.busca = semAcento(`${c.nome} ${c.detalhe}`); });
  const precoHTML = m => `<small>R$</small>${esc(brl(m.preco).replace(/^R\$\s*/, ''))}`;
  const doModelo = id => CAT.camisas.filter(c => c.modelo === id);

  const catCard = (c, comModelo = false) => `
      <li class="cat-card">
        <button class="cat-card__media" type="button" data-cat-open="${esc(c.id)}" aria-label="Ver fotos: ${esc(c.nome)}">
          <img src="${esc(c.capa)}" alt="${esc(c.nome)}" loading="lazy" decoding="async" width="480" height="480">
          ${comModelo ? `<span class="cat-card__model">${esc(modeloDe(c).nome)}</span>` : ''}
          ${c.fotos.length > 1 ? `<span class="post__count"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-stack"/></svg>${c.fotos.length}</span>` : ''}
        </button>
        <div class="cat-card__body">
          <h3 class="cat-card__team">${esc(c.time)}</h3>
          <p class="cat-card__detail">${esc(c.detalhe)}</p>
          <div class="cat-card__buy">
            <span class="cat-card__price">${precoHTML(modeloDe(c))}</span>
            <button class="btn btn--solid btn--sm" type="button" data-cat-order="${esc(c.id)}">Quero essa</button>
          </div>
        </div>
      </li>`;

  /* ---------- home: atalhos por modelo e camisas em destaque ---------- */
  const destaquesBox = $('[data-cat-destaques]');
  if (destaquesBox && MODELOS.length) {
    $('[data-cat-models]').innerHTML = MODELOS.map(m => {
      const camisas = doModelo(m.id);
      return `
      <a class="cat-model" href="/catalogo#${esc(m.id)}">
        <span class="cat-model__text">
          <span class="cat-model__name">${esc(m.nome)}</span>
          <span class="cat-model__desc">${esc(FRASE_MODELO[m.id] || '')}</span>
          <span class="cat-model__foot">
            <span class="cat-model__price">${precoHTML(m)}</span>
            <span class="cat-model__count">${camisas.length} camisas <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-arrow"/></svg></span>
          </span>
        </span>
        ${camisas[0] ? `<span class="cat-model__foto"><img src="${esc(camisas[0].capa)}" alt="" loading="lazy" decoding="async" width="480" height="480"></span>` : ''}
      </a>`;
    }).join('');
    // primeiro os escolhidos no catalogo.json ("destaques"); o resto são as mais recentes, alternando os modelos
    const escolhidas = (CAT.destaques || []).map(id => CAT.camisas.find(c => c.id === String(id))).filter(Boolean);
    const filas = MODELOS.map(m => doModelo(m.id).filter(c => !escolhidas.includes(c)));
    for (let i = 0; escolhidas.length < DESTAQUES && filas.some(f => f.length); i++) {
      const fila = filas[i % filas.length];
      if (fila.length) escolhidas.push(fila.shift());
    }
    destaquesBox.innerHTML = escolhidas.slice(0, DESTAQUES).map(c => catCard(c, true)).join('');
    $('[data-cat-all]').textContent = `Ver as ${CAT.camisas.length} camisas do catálogo`;
  } else if (destaquesBox) {
    $('#catalogo').hidden = true;   // sem js/catalogo.js, a seção não aparece
  }

  /* ---------- catálogo completo (catalogo.html): abas por modelo, filtro por time, busca e "ver mais" ---------- */
  const catGrid = $('[data-cat-grid]');
  const cat = { modelo: MODELOS[0]?.id, time: '', busca: '', limite: POR_PAGINA };
  const daAba = (modelo = cat.modelo) => doModelo(modelo);
  const termos = () => semAcento(cat.busca).split(/\s+/).filter(Boolean);
  const confere = c => termos().every(t => c.busca.includes(t));
  const filtradas = () => daAba().filter(c => (!cat.time || c.time === cat.time) && confere(c));

  const renderTimes = () => {
    const contagem = new Map();
    daAba().filter(confere).forEach(c => contagem.set(c.time, (contagem.get(c.time) || 0) + 1));
    if (cat.time && !contagem.has(cat.time)) cat.time = '';
    const times = [...contagem].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
    const total = times.reduce((n, [, q]) => n + q, 0);
    $('[data-cat-teams]').innerHTML = [['', total], ...times].map(([time, q]) =>
      `<button class="catalog__team" type="button" data-cat-time="${esc(time)}" aria-pressed="${time === cat.time}">${time ? esc(time) : 'Todos os times'} <small>${q}</small></button>`).join('');
  };

  const renderGrid = (soMais = false) => {
    const lista = filtradas();
    const m = MODELOS.find(x => x.id === cat.modelo);
    const visiveis = lista.slice(0, cat.limite);
    if (soMais) catGrid.insertAdjacentHTML('beforeend', visiveis.slice(catGrid.children.length).map(c => catCard(c)).join(''));
    else catGrid.innerHTML = visiveis.map(c => catCard(c)).join('');
    $('[data-cat-count]').textContent = lista.length
      ? `${lista.length} camisa${lista.length > 1 ? 's' : ''} ${m ? `${m.nome} · ${brl(m.preco)} cada` : ''}${cat.time ? ` · ${cat.time}` : ''}`
      : '';
    $('[data-cat-more-box]').hidden = visiveis.length >= lista.length;
    // sem resultado: mostra se a busca acha camisas nos outros modelos
    const vazio = !lista.length;
    $('[data-cat-empty]').hidden = !vazio;
    if (vazio) {
      $('[data-cat-other]').innerHTML = MODELOS.filter(x => x.id !== cat.modelo).map(x => {
        const q = daAba(x.id).filter(c => (!cat.time || c.time === cat.time) && confere(c)).length;
        return q ? `<button class="btn btn--line btn--sm" type="button" data-cat-tab="${esc(x.id)}">Ver ${q} no modelo ${esc(x.nome)}</button>` : '';
      }).join('');
    }
  };

  // troca a aba; quando é a pessoa que troca, o endereço guarda a aba (/catalogo#retro)
  const setModelo = (id, marcar = false) => {
    cat.modelo = id;
    cat.limite = POR_PAGINA;
    $$('[data-cat-tab]', $('[data-cat-tabs]')).forEach(b => {
      const on = b.dataset.catTab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $$('[data-cat-head-models] a').forEach(a => a.classList.toggle('is-on', a.hash === `#${id}`));
    if (marcar) history.replaceState(null, '', `#${id}`);
    renderTimes();
    renderGrid();
  };

  if (catGrid && MODELOS.length) {
    const tabs = $('[data-cat-tabs]');
    tabs.innerHTML = MODELOS.map(m => `
      <button class="catalog__tab" type="button" role="tab" aria-selected="false" data-cat-tab="${esc(m.id)}">
        <b>${esc(m.nome)}</b><span>${esc(brl(m.preco))}</span>
      </button>`).join('');
    tabs.addEventListener('keydown', e => {
      const i = MODELOS.findIndex(m => m.id === cat.modelo);
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      const prox = MODELOS[(i + dir + MODELOS.length) % MODELOS.length];
      setModelo(prox.id, true);
      $(`[data-cat-tab="${prox.id}"]`, tabs).focus();
    });
    let espera;
    $('[data-cat-search]').addEventListener('input', e => {
      clearTimeout(espera);
      espera = setTimeout(() => { cat.busca = e.target.value; cat.limite = POR_PAGINA; renderTimes(); renderGrid(); }, 160);
    });
    $('[data-cat-teams]').addEventListener('click', e => {
      const b = e.target.closest('[data-cat-time]');
      if (!b) return;
      cat.time = b.dataset.catTime;
      cat.limite = POR_PAGINA;
      $$('[data-cat-time]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      renderGrid();
    });
    $('[data-cat-more]').addEventListener('click', () => { cat.limite += POR_PAGINA; renderGrid(true); });
    $('#catalogo').addEventListener('click', e => {
      const tab = e.target.closest('[data-cat-tab]');
      if (tab) setModelo(tab.dataset.catTab, true);
    });

    // topo da página: preço de cada modelo (atalho para a aba)
    const headModels = $('[data-cat-head-models]');
    if (headModels) headModels.innerHTML = MODELOS.map(m => `<li><a href="#${esc(m.id)}">${esc(m.nome)} <b>${esc(brl(m.preco))}</b></a></li>`).join('');

    setModelo(MODELOS.find(m => `#${m.id}` === location.hash)?.id || cat.modelo);
  } else if (catGrid) {
    $('#catalogo').hidden = true;   // sem js/catalogo.js, a seção não aparece
  }

  // link direto para uma camisa (vai na mensagem do pedido): versattesports.com.br/catalogo#camisa-<código>
  // (links antigos, versattesports.com.br/#camisa-<código>, também abrem a camisa, na home)
  const abrirDoLink = mudou => {
    const c = CAT.camisas.find(x => `#camisa-${x.id}` === location.hash);
    if (c) {
      if (catGrid && c.modelo !== cat.modelo) setModelo(c.modelo);
      openProduct(c);
      return;
    }
    const m = catGrid && MODELOS.find(x => `#${x.id}` === location.hash);
    if (m && mudou) {          // atalhos do topo do catálogo (#torcedor, #jogador, #retro)
      if (m.id !== cat.modelo) setModelo(m.id);
      $('#catalogo').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  };
  abrirDoLink(false);
  addEventListener('hashchange', () => abrirDoLink(true));

  // cliques da galeria, das prévias e dos cards do catálogo
  document.addEventListener('click', e => {
    const opener = e.target.closest('[data-open-post]');
    if (opener) { openViewer(postOf(opener)); return; }
    const card = e.target.closest('[data-cat-open], [data-cat-order]');
    if (card) {
      const c = CAT.camisas.find(x => x.id === (card.dataset.catOpen || card.dataset.catOrder));
      if (c) card.dataset.catOpen ? openProduct(c) : openOrder(c);
      return;
    }
    const buy = e.target.closest('[data-order-open]');
    if (buy) openOrder(buy.closest('[data-viewer]') ? viewerPost : buy.closest('[data-product]') ? productItem : postOf(buy));
  });

  /* ---------- loja (carrinho + pagamento pelo Mercado Pago) · DESLIGADA por enquanto ----------
     Só carrega js/loja.js quando o loja.json tem "ativa": true. Para testar antes de liberar,
     abra o site com ?loja=teste (fica ligado neste navegador; desliga com ?loja=off). */
  window.VERSATTE_SITE = { toast, abrirModal: openModal, modalFechado: closedModal, brl, esc, SITE_URL };
  (async () => {
    const modo = new URLSearchParams(location.search).get('loja');
    let teste = false;
    try {
      if (modo === 'teste') localStorage.setItem('vs-loja-teste', '1');
      if (modo === 'off') localStorage.removeItem('vs-loja-teste');
      teste = localStorage.getItem('vs-loja-teste') === '1';
    } catch {}
    let cfg;
    try { cfg = await (await fetch('loja.json', { cache: 'no-cache' })).json(); } catch { return; }
    if (!cfg.ativa && !teste) return;
    window.VERSATTE_LOJA = { ...cfg, teste: !cfg.ativa };
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'css/loja.css?v=20261107-1';
    css.onload = () => dispatchEvent(new Event('resize'));   // js/tela.js reaplica o ajuste nas regras novas
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'js/loja.js?v=20261107-1';
    document.head.appendChild(js);
  })();

  /* ---------- revelar ao rolar ---------- */
  const reveals = $$('.reveal');
  reveals.forEach(el => {
    const sibs = [...el.parentElement.children].filter(c => c.classList.contains('reveal'));
    const i = sibs.indexOf(el);
    if (i > 0) el.style.transitionDelay = `${Math.min(i % 2 ? 1 : 0, 2) * 120}ms`;
  });
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
      setTimeout(() => { e.target.style.transitionDelay = ''; }, 1400);
    }), { threshold: .1, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('is-in'));
  }

  /* ============================================================
     VERSATTE CARDS · cartas do jogo (mesmo visual do protótipo)
     ============================================================ */
  const RARITY = {
    muito: { label: 'Muito rara', color: '#B866FF' },
    especial: { label: 'Especial', color: '#FFC940' },
  };
  const TEAM_COLORS = { fla: ['#D3202A', '#121212'], cam: ['#141414', '#FFFFFF'] };
  const CARDS = {
    urubu: { name: 'Urubu Infinito', team: 'fla', rarity: 'especial', emoji: '🦅', role: 'Líder da Liga', ability: 'Pressão', power: 12, number: 12 },
    galo: { name: 'Galo do Trovão', team: 'cam', rarity: 'muito', emoji: '🐓', role: 'Força', ability: 'Ataque', power: 9, number: 8 },
  };
  const GEM = {
    muito: '<path d="M4 1.5 7.5 6 4 10.5 .5 6Z"/><path d="M8 1.5 11.5 6 8 10.5 4.5 6Z" opacity=".75"/>',
    especial: '<path d="m6 .6 1.6 3.5 3.8.4-2.9 2.6.8 3.8L6 9 2.7 10.9l.8-3.8L.6 4.5l3.8-.4Z"/>',
  };
  const EMOJI_FONT = `'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif`;
  let uid = 0;

  function heroArt(c, colors) {
    const g = `vg${++uid}`;
    const burst = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2, r = i % 2 ? 62 : 92;
      return `${(100 + Math.cos(a) * r).toFixed(1)},${(112 + Math.sin(a) * r).toFixed(1)}`;
    }).join(' ');
    return `
      <svg viewBox="0 0 200 240" aria-hidden="true">
        <defs>
          <radialGradient id="${g}" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#FFE27A"/><stop offset="1" stop-color="${colors[0]}"/></radialGradient>
          <pattern id="${g}h" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.6" fill="#000" opacity=".25"/></pattern>
        </defs>
        <polygon points="${burst}" fill="url(#${g})" stroke="#05080f" stroke-width="4" stroke-linejoin="round"/>
        <polygon points="${burst}" fill="url(#${g}h)"/>
        <text x="100" y="146" text-anchor="middle" font-size="92" style="font-family:${EMOJI_FONT}">${c.emoji}</text>
        <text x="166" y="58" class="art-pow" text-anchor="middle">POW!</text>
      </svg>`;
  }

  const back = `
    <div class="face back">
      <div class="b-grid"></div><div class="b-ring"></div>
      <img class="b-logo" src="assets/img/logo-vs.webp" alt="" draggable="false">
      <div class="b-title">VERSATTE<span>Cards</span></div>
    </div>`;

  function cardHTML(key) {
    if (key === 'back') {
      return `<div class="vcard only-back" role="img" aria-label="Verso de uma carta Versatte Cards"><div class="card-float"><div class="card-tilt"><div class="card-flip"><div class="face front"></div>${back}</div></div></div></div>`;
    }
    const c = CARDS[key], R = RARITY[c.rarity], colors = TEAM_COLORS[c.team];
    return `
      <div class="vcard r-${c.rarity} k-mascot k-hero" role="img" aria-label="Carta ${c.name}, ${R.label}, coleção Juízo Final"
           style="--c1:${colors[0]};--c2:${colors[1]};--rc:${R.color}">
        <div class="card-float" style="animation-delay:${(-Math.random() * 6).toFixed(2)}s"><div class="card-tilt"><div class="card-flip">
          <div class="face front">
            <div class="f-bg"></div>
            <div class="f-rays"></div>
            <div class="f-art">${heroArt(c, colors)}</div>
            <img class="f-wm" src="assets/img/logo-vs.webp" alt="" draggable="false">
            <div class="f-top">
              <span class="f-num">#${String(c.number).padStart(2, '0')}</span>
              <span class="f-col">Juízo Final</span>
              <span class="f-gem"><svg viewBox="0 0 12 12" fill="currentColor">${GEM[c.rarity]}</svg></span>
            </div>
            <div class="f-foot">
              <div class="f-name">${c.name}</div>
              <div class="f-sub">${c.role} · ${c.ability} +${c.power}</div>
              <div class="f-rar">${c.role} · ${R.label}</div>
            </div>
            <div class="f-holo"></div>
            <div class="f-sparkle"></div>
            <div class="f-frame"></div>
            <div class="f-glare"></div>
          </div>
          ${back}
        </div></div></div>
      </div>`;
  }
  $$('[data-vcard]').forEach(host => { host.innerHTML = cardHTML(host.dataset.vcard); });

  // inclinação 3D + brilho holográfico seguindo o dedo/mouse
  const tiltHosts = $$('[data-tilt]');
  const setTilt = (card, px, py) => {
    card.style.setProperty('--rx', `${((.5 - py) * 22).toFixed(2)}deg`);
    card.style.setProperty('--ry', `${((px - .5) * 26).toFixed(2)}deg`);
    card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    card.style.setProperty('--hyp', Math.min(1, Math.hypot(px - .5, py - .5) * 2).toFixed(3));
  };
  const state = new Map();
  tiltHosts.forEach(host => {
    const card = $('.vcard', host);
    const st = { card, active: false, visible: false, phase: Math.random() * 10 };
    state.set(host, st);
    host.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      st.active = true;
      card.classList.add('is-tilting');
      setTilt(card, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
    });
    const release = () => { st.active = false; card.classList.remove('is-tilting'); setTilt(card, .5, .5); };
    host.addEventListener('pointerleave', release);
    host.addEventListener('pointercancel', release);
    if (host.hasAttribute('data-flip')) host.addEventListener('click', () => card.classList.toggle('flipped'));
  });
  // quando ninguém está mexendo, a carta balança sozinha (fica viva também no celular)
  if (!reduceMotion && tiltHosts.length) {
    const io = new IntersectionObserver(entries => entries.forEach(e => { state.get(e.target).visible = e.isIntersecting; }));
    tiltHosts.forEach(h => io.observe(h));
    const loop = t => {
      state.forEach(st => {
        if (!st.visible || st.active) return;
        const k = t / 1000 + st.phase;
        setTilt(st.card, .5 + Math.sin(k * .7) * .32, .5 + Math.cos(k * .5) * .22);
      });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ---------- rodapé ---------- */
  $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
})();
