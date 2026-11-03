/* ============================================================
   VERSATTE SPORTS · loja: carrinho e pagamento pelo Mercado Pago
   Carregado pelo js/main.js SÓ quando o loja.json tem "ativa": true,
   ou no modo de teste (site aberto com ?loja=teste).
   Fluxo: "Quero essa" > tamanho > Adicionar ao carrinho > carrinho >
   entrega e contato > servidor da loja (servidor/worker.js) cria o pagamento >
   página do Mercado Pago > volta para pedido.html.
   Sem "api" no loja.json, o pagamento é só simulado (nada é cobrado).
   Toda a interface da loja é montada aqui: as páginas não têm nada dela no HTML.
   ============================================================ */
(() => {
  const CFG = window.VERSATTE_LOJA, CAT = window.VERSATTE_CATALOGO, SITE = window.VERSATTE_SITE;
  if (!CFG || !CAT || !SITE) return;   // página sem catálogo (não vende nada)
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const { esc, brl, toast } = SITE;
  const CHAVE = 'vs-carrinho', CHAVE_PEDIDO = 'vs-pedido';
  const TAMANHOS = CAT.tamanhos;
  const MAX_PADRAO = { torcedor: '4XL', jogador: '3XL' };   // igual ao SIZE_MAX do main.js
  const MAX_QTD = CFG.maxPorCamisa || 5, MAX_ITENS = CFG.maxItens || 10;
  const camisaDe = id => CAT.camisas.find(c => c.id === id);
  const modeloDe = c => CAT.modelos.find(m => m.id === c.modelo) || { nome: c.modelo, preco: 0 };
  const tamanhoOk = (c, t) => {
    const i = TAMANHOS.indexOf(t), max = TAMANHOS.indexOf(c.max || MAX_PADRAO[c.modelo] || TAMANHOS.at(-1));
    return i >= 0 && i <= max;
  };

  /* ---------- carrinho (guardado só neste navegador): [{ id, tamanho, qtd }] ---------- */
  let itens = [];
  try { itens = JSON.parse(localStorage.getItem(CHAVE)) || []; } catch {}
  itens = itens.filter(i => camisaDe(i.id) && tamanhoOk(camisaDe(i.id), i.tamanho)).slice(0, MAX_ITENS);
  const salvar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(itens)); } catch {} atualizar(); };

  // valores em centavos, com as mesmas regras do servidor (servidor/worker.js)
  const centavos = v => Math.round(Number(v) * 100);
  const reais = c => brl(c / 100);
  const precoDe = i => centavos(modeloDe(camisaDe(i.id)).preco);
  const subtotal = () => itens.reduce((n, i) => n + precoDe(i) * i.qtd, 0);
  const freteDe = sub => {
    if (!sub) return 0;
    const gratis = centavos(CFG.frete?.gratisAcima || 0);
    return gratis && sub >= gratis ? 0 : centavos(CFG.frete?.valor || 0);
  };

  const adicionar = (id, tamanho) => {
    const atual = itens.find(i => i.id === id && i.tamanho === tamanho);
    if (atual) atual.qtd = Math.min(MAX_QTD, atual.qtd + 1);
    else if (itens.length >= MAX_ITENS) { toast(`Seu carrinho já tem ${MAX_ITENS} camisas diferentes.`); return false; }
    else itens.push({ id, tamanho, qtd: 1 });
    salvar();
    return true;
  };

  /* ---------- ícone e botão do carrinho no menu ---------- */
  const sprite = $('svg symbol')?.parentNode;
  if (sprite && !$('#i-bag')) sprite.insertAdjacentHTML('beforeend', '<symbol id="i-bag" viewBox="0 0 24 24"><path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>');
  const navDm = $('.nav__dm');
  navDm?.insertAdjacentHTML('beforebegin', `
    <button class="nav__cart" type="button" data-cart-open aria-label="Abrir o carrinho">
      <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-bag"/></svg>
      <span class="nav__cart-count" data-cart-count hidden>0</span>
    </button>`);
  if (CFG.teste) {
    document.body.insertAdjacentHTML('beforeend', `
      <p class="loja-teste" role="note">Loja em <b>modo de teste</b>: nenhum pagamento é cobrado. <a href="?loja=off">Sair do teste</a></p>`);
  }

  /* ---------- "Quero essa camisa": botão Adicionar ao carrinho (só camisas do catálogo) ---------- */
  const order = $('[data-order]');
  let pedidoAtual = null;
  if (order) {
    $('.order__send', order).insertAdjacentHTML('beforebegin', `
      <div class="order__cart" data-order-cart hidden>
        <button class="btn btn--solid" type="button" data-cart-add><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-bag"/></svg> Adicionar ao carrinho</button>
        <p>Pague pelo site com Pix, cartão ou boleto, ou mande o pedido pelo WhatsApp ou Direct:</p>
      </div>`);
    document.addEventListener('vs:pedido', e => {
      pedidoAtual = e.detail?.modelo && e.detail?.capa ? e.detail : null;
      $('[data-order-cart]', order).hidden = !pedidoAtual;
    });
    $('[data-cart-add]', order).addEventListener('click', () => {
      const tamanho = $('[data-order-form]', order).tamanho.value;
      const legenda = $('[data-chips="tamanho"] legend', order);
      if (!tamanho) {
        legenda.classList.remove('is-alert'); void legenda.offsetWidth; legenda.classList.add('is-alert');
        toast('Escolha o tamanho antes de adicionar.');
        return;
      }
      if (!adicionar(pedidoAtual.id, tamanho)) return;
      order.close();
      abrir('itens');
    });
  }

  /* ---------- janela do carrinho: itens > entrega e contato > pagamento ---------- */
  const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  document.body.insertAdjacentHTML('beforeend', `
  <dialog class="order cart" data-cart aria-labelledby="cart-title">
    <div class="order__box">
      <button class="order__close" type="button" data-cart-close aria-label="Fechar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>

      <section class="cart__step" data-step="itens">
        <p class="order__kicker">Seu carrinho</p>
        <h2 class="cart__title" id="cart-title">Carrinho</h2>
        ${CFG.teste ? '<p class="cart__teste">Modo de teste: nenhum pagamento é cobrado.</p>' : ''}
        <ul class="cart__list" role="list" data-cart-list></ul>
        <p class="cart__empty" data-cart-empty>Seu carrinho está vazio. <a href="catalogo.html">Ver o catálogo</a></p>
        <dl class="cart__totals" data-cart-totals></dl>
        ${CFG.prazoEntrega ? `<p class="cart__prazo">${esc(CFG.prazoEntrega)}</p>` : ''}
        <div class="cart__actions">
          <button class="btn btn--line" type="button" data-cart-close>Continuar comprando</button>
          <button class="btn btn--solid" type="button" data-cart-next>Finalizar compra</button>
        </div>
      </section>

      <form class="cart__step" data-step="entrega" hidden novalidate>
        <button class="cart__back" type="button" data-cart-back><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6"/></svg> Voltar ao carrinho</button>
        <h2 class="cart__title">Entrega e contato</h2>
        <label class="field"><span>Nome completo *</span><input name="nome" autocomplete="name" required maxlength="80"></label>
        <div class="field-row">
          <label class="field"><span>E-mail *</span><input name="email" type="email" autocomplete="email" required maxlength="120"></label>
          <label class="field"><span>WhatsApp *</span><input name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" placeholder="(31) 9 0000-0000"></label>
        </div>
        <div class="field-row cart__cep">
          <label class="field"><span>CEP *</span><input name="cep" inputmode="numeric" autocomplete="postal-code" required maxlength="9" placeholder="00000-000"></label>
          <p class="cart__cep-info" data-cep-info></p>
        </div>
        <label class="field"><span>Rua *</span><input name="rua" autocomplete="address-line1" required maxlength="120"></label>
        <div class="field-row">
          <label class="field"><span>Número *</span><input name="numero" inputmode="numeric" required maxlength="10"></label>
          <label class="field"><span>Complemento <small>(opcional)</small></span><input name="complemento" autocomplete="address-line2" maxlength="60"></label>
        </div>
        <label class="field"><span>Bairro *</span><input name="bairro" required maxlength="60"></label>
        <div class="field-row cart__cidade">
          <label class="field"><span>Cidade *</span><input name="cidade" autocomplete="address-level2" required maxlength="60"></label>
          <label class="field"><span>UF *</span><select name="uf" autocomplete="address-level1" required><option value=""></option>${UFS.map(u => `<option>${u}</option>`).join('')}</select></label>
        </div>
        <label class="cart__aceite"><input type="checkbox" name="aceite" required> <span>Li e aceito as <a href="politicas.html" target="_blank" rel="noopener">políticas de entrega, trocas e privacidade</a>.</span></label>
        <dl class="cart__totals" data-cart-totals></dl>
        <p class="cart__status" role="status" aria-live="polite" data-cart-status></p>
        <button class="btn btn--solid cart__pay" type="submit" data-cart-pay>Ir para o pagamento</button>
        <p class="cart__note">Você paga na página segura do Mercado Pago, com Pix, cartão ou boleto. Usamos seus dados só para entregar o pedido e falar com você sobre ele.</p>
      </form>
    </div>
  </dialog>`);

  const cart = $('[data-cart]');
  const formEntrega = $('[data-step="entrega"]', cart);
  const status = $('[data-cart-status]', cart);

  const totaisHTML = () => {
    const sub = subtotal(), frete = freteDe(sub);
    return `
      <div><dt>Subtotal</dt><dd>${reais(sub)}</dd></div>
      <div><dt>Frete</dt><dd>${frete ? reais(frete) : 'Grátis'}</dd></div>
      <div class="cart__total"><dt>Total</dt><dd>${reais(sub + frete)}</dd></div>`;
  };

  function atualizar() {
    const qtd = itens.reduce((n, i) => n + i.qtd, 0);
    const badge = $('[data-cart-count]');
    if (badge) { badge.textContent = qtd; badge.hidden = !qtd; }
    $('[data-cart-open]')?.setAttribute('aria-label', qtd ? `Abrir o carrinho (${qtd} ${qtd > 1 ? 'camisas' : 'camisa'})` : 'Abrir o carrinho');
    $('[data-cart-list]', cart).innerHTML = itens.map((i, k) => {
      const c = camisaDe(i.id), m = modeloDe(c);
      return `
        <li class="cart__item" data-k="${k}">
          <img src="${esc(c.capa)}" alt="" width="64" height="64" loading="lazy">
          <div class="cart__info">
            <b>${esc(c.time)}</b>
            <span>${esc(c.detalhe)}</span>
            <small>${esc(m.nome)} · Tamanho ${esc(i.tamanho)}</small>
          </div>
          <div class="cart__qty" role="group" aria-label="Quantidade">
            <button type="button" data-qtd="-1" aria-label="Uma a menos">−</button>
            <span>${i.qtd}</span>
            <button type="button" data-qtd="1" aria-label="Uma a mais" ${i.qtd >= MAX_QTD ? 'disabled' : ''}>+</button>
          </div>
          <strong class="cart__price">${reais(precoDe(i) * i.qtd)}</strong>
          <button class="cart__remove" type="button" data-remove aria-label="Tirar ${esc(c.nome)} do carrinho"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </li>`;
    }).join('');
    $('[data-cart-empty]', cart).hidden = itens.length > 0;
    $$('[data-cart-totals]', cart).forEach(dl => { dl.innerHTML = itens.length ? totaisHTML() : ''; });
    $('[data-cart-next]', cart).disabled = !itens.length;
  }

  const passo = nome => {
    $$('.cart__step', cart).forEach(s => { s.hidden = s.dataset.step !== nome; });
    $('.order__box', cart).scrollTop = 0;
    cart.scrollTop = 0;
  };
  function abrir(qual = 'itens') {
    atualizar();
    passo(itens.length ? qual : 'itens');
    status.textContent = '';
    if (!cart.open) SITE.abrirModal(cart);
  }

  $('[data-cart-open]')?.addEventListener('click', () => abrir());
  $$('[data-cart-close]', cart).forEach(b => b.addEventListener('click', () => cart.close()));
  $('[data-cart-next]', cart).addEventListener('click', () => { passo('entrega'); formEntrega.nome.focus(); });
  $('[data-cart-back]', cart).addEventListener('click', () => passo('itens'));
  cart.addEventListener('click', e => { if (e.target === cart) cart.close(); });
  cart.addEventListener('close', () => SITE.modalFechado());
  $('[data-cart-list]', cart).addEventListener('click', e => {
    const li = e.target.closest('[data-k]');
    if (!li) return;
    const item = itens[+li.dataset.k];
    const mais = e.target.closest('[data-qtd]');
    if (mais) item.qtd = Math.max(1, Math.min(MAX_QTD, item.qtd + +mais.dataset.qtd));
    else if (e.target.closest('[data-remove]')) itens.splice(+li.dataset.k, 1);
    else return;
    salvar();
  });

  /* ---------- CEP: preenche o endereço pelo ViaCEP (serviço público e gratuito) ---------- */
  const cepInfo = $('[data-cep-info]', cart);
  // campo corrigido perde a marca de erro; sem nenhum erro, some o aviso
  const limparErro = campo => {
    campo.closest('.field')?.classList.remove('is-invalid');
    if (!$('.field.is-invalid', formEntrega) && status.classList.contains('is-err')) { status.textContent = ''; status.className = 'cart__status'; }
  };
  formEntrega.cep.addEventListener('input', async e => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 8);
    e.target.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
    cepInfo.textContent = '';
    if (d.length !== 8) return;
    cepInfo.textContent = 'Buscando o endereço…';
    try {
      const r = await (await fetch(`https://viacep.com.br/ws/${d}/json/`)).json();
      if (r.erro) throw new Error('CEP não encontrado');
      const f = formEntrega;
      if (r.logradouro) f.rua.value = r.logradouro;
      if (r.bairro) f.bairro.value = r.bairro;
      if (r.localidade) f.cidade.value = r.localidade;
      if (r.uf) f.uf.value = r.uf;
      [f.cep, f.rua, f.bairro, f.cidade, f.uf].forEach(limparErro);
      cepInfo.textContent = `${r.localidade} · ${r.uf}`;
      (r.logradouro ? f.numero : f.rua).focus();
    } catch {
      cepInfo.textContent = 'Não achamos esse CEP. Preencha o endereço à mão.';
    }
  });
  formEntrega.addEventListener('input', e => limparErro(e.target));

  // mesmas validações do servidor
  const REGRAS = {
    nome: v => v.length >= 3, email: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
    whatsapp: v => /^\d{10,13}$/.test(v.replace(/\D/g, '')), cep: v => /^\d{8}$/.test(v.replace(/\D/g, '')),
    rua: v => v.length >= 2, numero: v => v.length >= 1, bairro: v => v.length >= 2, cidade: v => v.length >= 2, uf: v => UFS.includes(v),
  };
  const gerarCodigo = () => `VS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  formEntrega.addEventListener('submit', async e => {
    e.preventDefault();
    const f = formEntrega;
    const dados = Object.fromEntries(Object.keys(REGRAS).map(k => [k, f[k].value.trim()]));
    const errados = Object.keys(REGRAS).filter(k => !REGRAS[k](dados[k]));
    $$('.field', f).forEach(el => el.classList.remove('is-invalid'));
    errados.forEach(k => f[k].closest('.field').classList.add('is-invalid'));
    if (errados.length) { status.textContent = 'Confira os campos marcados.'; status.className = 'cart__status is-err'; f[errados[0]].focus(); return; }
    if (!f.aceite.checked) { status.textContent = 'Para continuar, aceite as políticas da loja.'; status.className = 'cart__status is-err'; f.aceite.focus(); return; }

    const pedido = {
      itens: itens.map(({ id, tamanho, qtd }) => ({ id, tamanho, qtd })),
      cliente: { nome: dados.nome, email: dados.email, whatsapp: dados.whatsapp.replace(/\D/g, '') },
      entrega: { cep: dados.cep.replace(/\D/g, ''), rua: dados.rua, numero: dados.numero, complemento: f.complemento.value.trim(), bairro: dados.bairro, cidade: dados.cidade, uf: dados.uf },
    };
    const pagar = $('[data-cart-pay]', cart);
    pagar.disabled = true;
    pagar.textContent = 'Abrindo o pagamento…';
    status.textContent = ''; status.className = 'cart__status';
    try {
      let resposta;
      if (CFG.api) {
        const r = await fetch(`${CFG.api.replace(/\/$/, '')}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pedido) });
        resposta = await r.json().catch(() => ({}));
        if (!r.ok || !resposta.url) throw new Error(resposta.erro || `HTTP ${r.status}`);
      } else {
        // sem servidor configurado: simulação no próprio navegador (nada é cobrado)
        const codigo = gerarCodigo();
        resposta = { pedido: codigo, url: `pedido.html?status=simulado&external_reference=${codigo}` };
      }
      const sub = subtotal();
      try { localStorage.setItem(CHAVE_PEDIDO, JSON.stringify({ pedido: resposta.pedido, total: sub + freteDe(sub), itens: pedido.itens.length })); } catch {}
      location.href = resposta.url;
    } catch (erro) {
      console.warn('Loja:', erro.message);
      const resumo = itens.map(i => `${camisaDe(i.id).nome} (${modeloDe(camisaDe(i.id)).nome}, tamanho ${i.tamanho}) x${i.qtd}`).join('; ');
      status.innerHTML = `Não deu para abrir o pagamento agora (${esc(erro.message)}). Tente de novo ou <a href="https://wa.me/553193168184?text=${encodeURIComponent(`Olá! Quero comprar pelo site: ${resumo}.`)}" target="_blank" rel="noopener">peça pelo WhatsApp</a>.`;
      status.className = 'cart__status is-err';
      pagar.disabled = false;
      pagar.textContent = 'Ir para o pagamento';
    }
  });

  atualizar();
  // pedido.html manda de volta para cá com #carrinho quando o pagamento não foi concluído
  if (location.hash === '#carrinho') { history.replaceState(null, '', location.pathname + location.search); abrir(); }
})();
