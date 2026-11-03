/*
  VERSATTE SPORTS · servidor da loja (Cloudflare Worker)

  O site é estático (GitHub Pages) e não pode guardar a chave do Mercado Pago.
  Este servidor pequeno faz a parte que precisa dela:
    POST /checkout  recebe o carrinho e os dados de entrega, confere tudo, calcula o
                    total com os preços do próprio site (nunca com os do navegador) e
                    cria o pagamento no Mercado Pago (Checkout Pro). Devolve o link
                    da página de pagamento.
    POST /webhook   recebe o aviso do Mercado Pago, confere a assinatura, consulta o
                    pagamento e, se aprovado, avisa a loja por e-mail.
    GET  /          mostra se está em modo simulação ou ligado ao Mercado Pago.

  Configuração no painel do Cloudflare (Workers > o worker > Settings > Variables and Secrets):
    SITE_URL           https://versattesports.com.br (de onde lê js/catalogo.js e loja.json)
    MP_ACCESS_TOKEN    SEGREDO: Access Token do Mercado Pago. Sem ele = modo simulação
                       (nada é cobrado; o link leva direto ao pedido.html).
    MP_WEBHOOK_SECRET  SEGREDO: assinatura secreta dos webhooks (Suas integrações > Webhooks).
    AVISO_EMAIL        opcional: e-mail que recebe cada pedido pago (enviado pelo FormSubmit,
                       o mesmo do formulário de contato).
    PEDIDOS            opcional: um KV namespace ligado com esse nome evita aviso repetido.
  Passo a passo completo em servidor/LEIA-ME.txt.
*/

const TAMANHOS = ['P', 'M', 'G', 'GG', '2XL', '3XL', '4XL'];
const MAX_PADRAO = { torcedor: '4XL', jogador: '3XL' };   // igual ao SIZE_MAX do js/main.js
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const MP_API = 'https://api.mercadopago.com';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsDe(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/checkout' && request.method === 'POST') return json(await checkout(request, env), 200, cors);
      if (url.pathname === '/webhook' && request.method === 'POST') return await webhook(request, env, ctx);
      if (url.pathname === '/' && request.method === 'GET') return json({ loja: 'Versatte Sports', modo: env.MP_ACCESS_TOKEN ? 'mercado-pago' : 'simulacao' }, 200, cors);
      return json({ erro: 'não encontrado' }, 404, cors);
    } catch (e) {
      if (e instanceof ErroDoPedido) return json({ erro: e.message }, 400, cors);
      console.error('loja:', e.message);   // sem dados pessoais no log
      return json({ erro: 'erro no servidor da loja' }, 500, cors);
    }
  },
};

class ErroDoPedido extends Error {}

const json = (dados, status = 200, headers = {}) => new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

// só o próprio site chama o /checkout (no modo simulação também o computador de quem testa)
function corsDe(request, env) {
  const origem = request.headers.get('Origin') || '';
  const site = new URL(env.SITE_URL).origin;
  const local = !env.MP_ACCESS_TOKEN && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem);
  return origem === site || local
    ? { 'Access-Control-Allow-Origin': origem, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

/* ---------- catálogo e regras da loja, lidos do site publicado (cache de 5 minutos) ---------- */
let cache = { quando: 0 };
async function dadosDoSite(env) {
  if (Date.now() - cache.quando < 5 * 60 * 1000) return cache;
  const site = env.SITE_URL.replace(/\/$/, '');
  const [catJs, loja] = await Promise.all([
    fetch(`${site}/js/catalogo.js`, { cf: { cacheTtl: 300 } }).then(r => r.text()),
    fetch(`${site}/loja.json`, { cf: { cacheTtl: 300 } }).then(r => r.json()),
  ]);
  const cat = JSON.parse(catJs.slice(catJs.indexOf('{'), catJs.lastIndexOf('}') + 1));
  cache = {
    quando: Date.now(), loja,
    camisas: new Map(cat.camisas.map(c => [c.id, c])),
    precos: new Map(cat.modelos.map(m => [m.id, { nome: m.nome, centavos: Math.round(m.preco * 100) }])),
  };
  return cache;
}

// frete: valor fixo por pedido; grátis a partir de "gratisAcima" (igual ao js/loja.js)
const freteDe = (loja, sub) => {
  if (!sub) return 0;
  const gratis = Math.round((loja.frete?.gratisAcima || 0) * 100);
  return gratis && sub >= gratis ? 0 : Math.round((loja.frete?.valor || 0) * 100);
};

/* ---------- POST /checkout ---------- */
const texto = (v, min, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length >= min && s.length <= max ? s : null;
};
const exigir = (v, campo) => { if (v == null) throw new ErroDoPedido(`confira o campo ${campo}`); return v; };

async function checkout(request, env) {
  const corpo = await request.json().catch(() => null);
  if (!corpo || !Array.isArray(corpo.itens)) throw new ErroDoPedido('pedido inválido');
  const { loja, camisas, precos } = await dadosDoSite(env);
  const maxItens = loja.maxItens || 10, maxQtd = loja.maxPorCamisa || 5;
  if (!corpo.itens.length || corpo.itens.length > maxItens) throw new ErroDoPedido('carrinho vazio ou grande demais');

  const itens = corpo.itens.map(i => {
    const c = camisas.get(String(i.id));
    if (!c) throw new ErroDoPedido('uma das camisas não está mais no catálogo');
    const t = TAMANHOS.indexOf(i.tamanho), max = TAMANHOS.indexOf(c.max || MAX_PADRAO[c.modelo] || '4XL');
    if (t < 0 || t > max) throw new ErroDoPedido(`tamanho indisponível para ${c.nome}`);
    const qtd = Number(i.qtd);
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > maxQtd) throw new ErroDoPedido('quantidade inválida');
    const preco = precos.get(c.modelo);
    if (!preco) throw new ErroDoPedido('modelo sem preço');
    return { camisa: c, modelo: preco.nome, tamanho: i.tamanho, qtd, centavos: preco.centavos };
  });

  const cli = corpo.cliente || {}, ent = corpo.entrega || {};
  const cliente = {
    nome: exigir(texto(cli.nome, 3, 80), 'nome'),
    email: exigir(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(cli.email || '').trim()) ? String(cli.email).trim().slice(0, 120) : null, 'e-mail'),
    whatsapp: exigir(/^\d{10,13}$/.test(String(cli.whatsapp || '').replace(/\D/g, '')) ? String(cli.whatsapp).replace(/\D/g, '') : null, 'WhatsApp'),
  };
  const entrega = {
    cep: exigir(/^\d{8}$/.test(String(ent.cep || '').replace(/\D/g, '')) ? String(ent.cep).replace(/\D/g, '') : null, 'CEP'),
    rua: exigir(texto(ent.rua, 2, 120), 'rua'),
    numero: exigir(texto(ent.numero, 1, 10), 'número'),
    complemento: texto(ent.complemento, 0, 60) || '',
    bairro: exigir(texto(ent.bairro, 2, 60), 'bairro'),
    cidade: exigir(texto(ent.cidade, 2, 60), 'cidade'),
    uf: exigir(UFS.includes(ent.uf) ? ent.uf : null, 'UF'),
  };

  const subtotal = itens.reduce((n, i) => n + i.centavos * i.qtd, 0);
  const frete = freteDe(loja, subtotal);
  const total = subtotal + frete;
  const pedido = `VS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const site = env.SITE_URL.replace(/\/$/, '');
  const retorno = `${site}/pedido.html`;

  // modo simulação: ainda sem conta no Mercado Pago, nada é cobrado
  if (!env.MP_ACCESS_TOKEN) return { pedido, total: total / 100, modo: 'simulacao', url: `${retorno}?status=simulado&external_reference=${pedido}` };

  const resumo = itens.map(i => `${i.camisa.nome} · ${i.modelo} · ${i.tamanho} x${i.qtd}`).join(' | ');
  const endereco = `${entrega.rua}, ${entrega.numero}${entrega.complemento ? ` (${entrega.complemento})` : ''} · ${entrega.bairro} · ${entrega.cidade}/${entrega.uf} · CEP ${entrega.cep}`;
  const preferencia = {
    items: itens.map(i => ({
      id: i.camisa.id,
      title: `Camisa ${i.camisa.nome} · ${i.modelo} · ${i.tamanho}`.slice(0, 250),
      picture_url: `${site}/${i.camisa.capa}`,
      category_id: 'fashion',
      quantity: i.qtd,
      currency_id: 'BRL',
      unit_price: i.centavos / 100,
    })),
    payer: { name: cliente.nome, email: cliente.email },
    shipments: { cost: frete / 100, mode: 'not_specified' },
    back_urls: { success: retorno, pending: retorno, failure: retorno },
    auto_return: 'approved',
    external_reference: pedido,
    notification_url: `${new URL(request.url).origin}/webhook`,
    statement_descriptor: 'VERSATTE',
    // volta no pagamento: é o que o aviso por e-mail usa (chaves simples, em minúsculas)
    metadata: { pedido, nome: cliente.nome, email: cliente.email, whatsapp: cliente.whatsapp, endereco, itens: resumo, subtotal: subtotal / 100, frete: frete / 100, total: total / 100 },
  };
  const r = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': pedido },
    body: JSON.stringify(preferencia),
  });
  const pref = await r.json().catch(() => ({}));
  if (!r.ok || !pref.init_point) throw new Error(`Mercado Pago respondeu ${r.status}`);
  // credenciais de teste antigas (TEST-...) usam a página de testes do Mercado Pago
  const pagina = env.MP_ACCESS_TOKEN.startsWith('TEST-') && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point;
  return { pedido, total: total / 100, modo: 'mercado-pago', url: pagina };
}

/* ---------- POST /webhook (aviso do Mercado Pago) ---------- */
async function webhook(request, env, ctx) {
  const url = new URL(request.url);
  const corpo = await request.json().catch(() => ({}));
  const tipo = url.searchParams.get('type') || url.searchParams.get('topic') || corpo.type;
  const id = url.searchParams.get('data.id') || url.searchParams.get('id') || corpo?.data?.id;
  if (tipo !== 'payment' || !id || !env.MP_ACCESS_TOKEN) return new Response('ok');   // outros avisos: ignora
  if (env.MP_WEBHOOK_SECRET && !(await assinaturaOk(request, url, env.MP_WEBHOOK_SECRET))) return new Response('assinatura inválida', { status: 401 });

  // nunca confia no corpo do aviso: consulta o pagamento direto no Mercado Pago
  const r = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
  if (!r.ok) return new Response('erro ao consultar o pagamento', { status: 502 });   // o Mercado Pago tenta de novo
  const pagamento = await r.json();
  if (pagamento.status === 'approved') ctx.waitUntil(avisar(env, pagamento));
  return new Response('ok');
}

// x-signature: "ts=...,v1=..."; v1 = HMAC-SHA256 (hex) de "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
async function assinaturaOk(request, url, segredo) {
  const partes = Object.fromEntries((request.headers.get('x-signature') || '').split(',').map(p => p.trim().split('=').map(s => s.trim())));
  if (!partes.ts || !partes.v1) return false;
  const dataId = (url.searchParams.get('data.id') || '').toLowerCase();
  const reqId = request.headers.get('x-request-id') || '';
  const manifesto = `${dataId ? `id:${dataId};` : ''}${reqId ? `request-id:${reqId};` : ''}ts:${partes.ts};`;
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(manifesto)));
  const hex = [...assinatura].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== partes.v1.length) return false;
  let diferenca = 0;
  for (let i = 0; i < hex.length; i++) diferenca |= hex.charCodeAt(i) ^ partes.v1.charCodeAt(i);
  return diferenca === 0;
}

// e-mail para a loja com tudo o que precisa para separar e enviar o pedido
async function avisar(env, pagamento) {
  if (!env.AVISO_EMAIL) return;
  // o Mercado Pago pode avisar o mesmo pagamento mais de uma vez; com o KV "PEDIDOS" ligado, avisa uma vez só
  if (env.PEDIDOS) {
    const chave = `avisado:${pagamento.id}`;
    if (await env.PEDIDOS.get(chave)) return;
    await env.PEDIDOS.put(chave, '1', { expirationTtl: 60 * 60 * 24 * 90 });
  }
  const m = pagamento.metadata || {};
  const reais = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const campos = {
    _subject: `Pedido pago no site · ${m.pedido || pagamento.external_reference}`,
    _template: 'table',
    _captcha: 'false',
    Pedido: m.pedido || pagamento.external_reference,
    'Pagamento (Mercado Pago)': `${pagamento.id} · ${pagamento.payment_method_id || ''} · ${reais(pagamento.transaction_amount)}`,
    Camisas: m.itens,
    Cliente: m.nome,
    'E-mail': m.email,
    WhatsApp: m.whatsapp,
    Entrega: m.endereco,
    'Subtotal · frete · total': `${reais(m.subtotal)} · ${reais(m.frete)} · ${reais(m.total)}`,
  };
  const r = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(env.AVISO_EMAIL)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: env.SITE_URL, Referer: `${env.SITE_URL}/` },
    body: JSON.stringify(campos),
  });
  if (!r.ok) console.error('loja: aviso por e-mail falhou', r.status);
}
