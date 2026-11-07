/*
  VERSATTE SPORTS · servidor da loja (Cloudflare Worker)

  O site é estático (GitHub Pages) e não pode guardar a chave do Mercado Pago.
  Este servidor pequeno faz a parte que precisa dela:
    POST /checkout  recebe o carrinho, o cupom e os dados de entrega, confere tudo, calcula
                    o total com os preços do próprio site (nunca com os do navegador) e
                    cria o pagamento no Mercado Pago (Checkout Pro). Devolve o link
                    da página de pagamento.
    POST /cupom     confere um cupom para o carrinho e devolve o desconto (o carrinho do
                    site mostra; o valor final é recalculado de novo no /checkout).
    POST /webhook   recebe o aviso do Mercado Pago, confere a assinatura, consulta o
                    pagamento e, se aprovado, conta o uso do cupom e avisa a loja por e-mail.
    GET  /          mostra se está em modo simulação ou ligado ao Mercado Pago.

  Configuração no painel do Cloudflare (Workers > o worker > Settings > Variables and Secrets):
    SITE_URL           https://versattesports.com.br (de onde lê js/catalogo.js e loja.json)
    MP_ACCESS_TOKEN    SEGREDO: Access Token do Mercado Pago. Sem ele = modo simulação
                       (nada é cobrado; o link leva direto à página /pedido).
    MP_WEBHOOK_SECRET  SEGREDO: assinatura secreta dos webhooks (Suas integrações > Webhooks).
    CUPONS             opcional: lista de cupons em JSON (formato em servidor/cupons-exemplo.json).
                       Fica só aqui, nunca no site: o repositório e o site são públicos.
    AVISO_EMAIL        opcional: e-mail que recebe cada pedido pago (enviado pelo FormSubmit,
                       o mesmo do formulário de contato).
    PEDIDOS            opcional: um KV namespace ligado com esse nome evita aviso repetido e
                       conta os usos dos cupons (necessário para cupom com "limite").
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
      if (url.pathname === '/cupom' && request.method === 'POST') return json(await conferirCupom(request, env), 200, cors);
      if (url.pathname === '/webhook' && request.method === 'POST') return await webhook(request, env, ctx);
      if (url.pathname === '/' && request.method === 'GET') return json({ loja: 'Versatte Sports', modo: env.MP_ACCESS_TOKEN ? 'mercado-pago' : 'simulacao' }, 200, cors);
      return json({ erro: 'não encontrado' }, 404, cors);
    } catch (e) {
      if (e instanceof ErroDoPedido) return json({ erro: e.message, campo: e.campo }, 400, cors);
      console.error('loja:', e.message);   // sem dados pessoais no log
      return json({ erro: 'erro no servidor da loja' }, 500, cors);
    }
  },
};

class ErroDoPedido extends Error {
  constructor(mensagem, campo) { super(mensagem); this.campo = campo; }
}

const json = (dados, status = 200, headers = {}) => new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const reais = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// só o próprio site chama o servidor (no modo simulação também o computador de quem testa)
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

// itens do carrinho conferidos com o catálogo (preço sempre o do site)
function lerItens(lista, { loja, camisas, precos }) {
  if (!Array.isArray(lista) || !lista.length || lista.length > (loja.maxItens || 10)) throw new ErroDoPedido('carrinho vazio ou grande demais');
  const maxQtd = loja.maxPorCamisa || 5;
  return lista.map(i => {
    const c = camisas.get(String(i.id));
    if (!c) throw new ErroDoPedido('uma das camisas não está mais no catálogo');
    const t = TAMANHOS.indexOf(i.tamanho), max = TAMANHOS.indexOf(c.max || MAX_PADRAO[c.modelo] || '4XL');
    if (t < 0 || t > max) throw new ErroDoPedido(`tamanho indisponível para ${c.nome}`);
    const qtd = Number(i.qtd);
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > maxQtd) throw new ErroDoPedido('quantidade inválida');
    const preco = precos.get(c.modelo);
    if (!preco) throw new ErroDoPedido('modelo sem preço');
    return { camisa: c, modelo: preco.nome, tamanho: i.tamanho, qtd, centavos: preco.centavos, desconto: 0 };
  });
}

/* ---------- cupons (variável CUPONS; formato em servidor/cupons-exemplo.json) ---------- */
let cacheCupons = { texto: null, lista: [] };
const normalizarCodigo = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 30);
const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });   // AAAA-MM-DD
function cuponsDe(env) {
  if (!env.CUPONS) return [];
  if (cacheCupons.texto === env.CUPONS) return cacheCupons.lista;
  let lista = [];
  try { lista = JSON.parse(env.CUPONS); } catch { console.error('loja: a variável CUPONS tem um erro de formato'); }
  cacheCupons = { texto: env.CUPONS, lista: (Array.isArray(lista) ? lista : []).filter(c => c && c.codigo).map(c => ({ ...c, codigo: normalizarCodigo(c.codigo) })) };
  return cacheCupons.lista;
}

// confere o cupom e reparte o desconto entre as camisas que valem (vai assim ao Mercado Pago)
async function aplicarCupom(codigo, itens, subtotal, env) {
  const cod = normalizarCodigo(codigo);
  const c = cuponsDe(env).find(x => x.codigo === cod);
  const invalido = new ErroDoPedido('cupom inválido ou expirado', 'cupom');
  if (!c || c.ativo === false) throw invalido;
  const hoje = hojeBR();
  if ((c.inicio && hoje < c.inicio) || (c.fim && hoje > c.fim)) throw invalido;
  if (c.minimo && subtotal < Math.round(c.minimo * 100)) throw new ErroDoPedido(`esse cupom vale para pedidos a partir de ${reais(c.minimo)}`, 'cupom');
  const vale = i => (!c.modelos?.length || c.modelos.includes(i.camisa.modelo))
    && (!c.times?.length || c.times.includes(i.camisa.time))
    && (!c.camisas?.length || c.camisas.map(String).includes(i.camisa.id));
  const elegiveis = itens.filter(vale);
  if (!elegiveis.length) throw new ErroDoPedido('esse cupom não vale para as camisas do carrinho', 'cupom');
  if (c.limite) {
    // contar usos precisa do KV PEDIDOS; sem ele, cupom com limite fica indisponível (não arrisca passar do limite)
    if (!env.PEDIDOS) { console.error('loja: cupom com limite precisa do KV PEDIDOS', cod); throw new ErroDoPedido('cupom indisponível no momento', 'cupom'); }
    const usos = Number(await env.PEDIDOS.get(`cupom:${cod}`)) || 0;
    if (usos >= c.limite) throw new ErroDoPedido('esse cupom já esgotou', 'cupom');
  }

  const base = elegiveis.reduce((n, i) => n + i.centavos * i.qtd, 0);
  let desconto = 0, freteGratis = false;
  if (c.tipo === 'frete') freteGratis = true;
  else if (c.tipo === 'valor') desconto = Math.min(Math.round(Number(c.valor) * 100), base);
  else if (c.tipo === 'percentual') {
    desconto = Math.round(base * Math.min(100, Math.max(0, Number(c.valor))) / 100);
    if (c.maxDesconto) desconto = Math.min(desconto, Math.round(c.maxDesconto * 100));
  } else { console.error('loja: cupom com tipo desconhecido', cod); throw invalido; }
  if (!(desconto >= 0)) throw invalido;

  // reparte o desconto proporcionalmente; os centavos que sobram vão para as linhas maiores
  let repartido = 0;
  for (const i of elegiveis) { i.desconto = Math.floor(desconto * i.centavos * i.qtd / base); repartido += i.desconto; }
  for (const i of [...elegiveis].sort((a, b) => b.centavos * b.qtd - a.centavos * a.qtd)) {
    if (repartido >= desconto) break;
    if (i.desconto < i.centavos * i.qtd) { i.desconto++; repartido++; }
  }
  return { codigo: cod, descricao: String(c.descricao || ''), desconto, freteGratis };
}

async function calcular(itens, codigo, loja, env) {
  const subtotal = itens.reduce((n, i) => n + i.centavos * i.qtd, 0);
  let frete = freteDe(loja, subtotal), desconto = 0, cupom = null;
  if (codigo) {
    cupom = await aplicarCupom(codigo, itens, subtotal, env);
    desconto = cupom.desconto;
    if (cupom.freteGratis) frete = 0;
  }
  return { subtotal, desconto, frete, total: subtotal - desconto + frete, cupom };
}

/* ---------- POST /cupom ---------- */
async function conferirCupom(request, env) {
  const corpo = await request.json().catch(() => null);
  if (!corpo || !corpo.codigo) throw new ErroDoPedido('digite o código do cupom', 'cupom');
  const dados = await dadosDoSite(env);
  const itens = lerItens(corpo.itens, dados);
  const v = await calcular(itens, corpo.codigo, dados.loja, env);
  return { codigo: v.cupom.codigo, descricao: v.cupom.descricao, desconto: v.desconto / 100, freteGratis: v.cupom.freteGratis, subtotal: v.subtotal / 100, frete: v.frete / 100, total: v.total / 100 };
}

/* ---------- POST /checkout ---------- */
const texto = (v, min, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length >= min && s.length <= max ? s : null;
};
const exigir = (v, campo) => { if (v == null) throw new ErroDoPedido(`confira o campo ${campo}`, campo); return v; };

async function checkout(request, env) {
  const corpo = await request.json().catch(() => null);
  if (!corpo) throw new ErroDoPedido('pedido inválido');
  const dados = await dadosDoSite(env);
  const itens = lerItens(corpo.itens, dados);

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

  const { subtotal, desconto, frete, total, cupom } = await calcular(itens, corpo.cupom, dados.loja, env);
  const pedido = `VS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const site = env.SITE_URL.replace(/\/$/, '');
  const retorno = `${site}/pedido`;
  const valores = { subtotal: subtotal / 100, desconto: desconto / 100, frete: frete / 100, total: total / 100, cupom: cupom?.codigo || '' };

  // modo simulação: ainda sem conta no Mercado Pago, nada é cobrado
  if (!env.MP_ACCESS_TOKEN) return { pedido, ...valores, modo: 'simulacao', url: `${retorno}?status=simulado&external_reference=${pedido}` };

  const resumo = itens.map(i => `${i.camisa.nome} · ${i.modelo} · ${i.tamanho} x${i.qtd}`).join(' | ');
  const endereco = `${entrega.rua}, ${entrega.numero}${entrega.complemento ? ` (${entrega.complemento})` : ''} · ${entrega.bairro} · ${entrega.cidade}/${entrega.uf} · CEP ${entrega.cep}`;
  // cada camisa com o desconto já embutido; se não dividir certinho pela quantidade,
  // a linha vira duas (uma unidade com 1 centavo a mais), para o total bater exatamente
  const items = [];
  for (const i of itens) {
    const item = {
      id: i.camisa.id,
      title: `Camisa ${i.camisa.nome} · ${i.modelo} · ${i.tamanho}${i.desconto ? ` (cupom ${cupom.codigo})` : ''}`.slice(0, 250),
      picture_url: `${site}/${i.camisa.capa}`,
      category_id: 'fashion',
      currency_id: 'BRL',
    };
    const linha = i.centavos * i.qtd - i.desconto;
    const unidade = Math.floor(linha / i.qtd), resto = linha - unidade * i.qtd;
    if (i.qtd - resto) items.push({ ...item, quantity: i.qtd - resto, unit_price: unidade / 100 });
    if (resto) items.push({ ...item, quantity: resto, unit_price: (unidade + 1) / 100 });
  }
  const preferencia = {
    items,
    payer: { name: cliente.nome, email: cliente.email },
    shipments: { cost: frete / 100, mode: 'not_specified' },
    back_urls: { success: retorno, pending: retorno, failure: retorno },
    auto_return: 'approved',
    external_reference: pedido,
    notification_url: `${new URL(request.url).origin}/webhook`,
    statement_descriptor: 'VERSATTE',
    // volta no pagamento: é o que o aviso por e-mail e a contagem do cupom usam (chaves simples, em minúsculas)
    metadata: { pedido, nome: cliente.nome, email: cliente.email, whatsapp: cliente.whatsapp, endereco, itens: resumo, ...valores },
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
  return { pedido, ...valores, modo: 'mercado-pago', url: pagina };
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
  if (pagamento.status === 'approved') ctx.waitUntil(pagamentoAprovado(env, pagamento));
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

async function pagamentoAprovado(env, pagamento) {
  const m = pagamento.metadata || {};
  // o Mercado Pago pode avisar o mesmo pagamento mais de uma vez; com o KV PEDIDOS, processa uma vez só
  if (env.PEDIDOS) {
    const chave = `avisado:${pagamento.id}`;
    if (await env.PEDIDOS.get(chave)) return;
    await env.PEDIDOS.put(chave, '1', { expirationTtl: 60 * 60 * 24 * 90 });
    // conta o uso do cupom (vale para o "limite" de cada cupom)
    if (m.cupom) {
      const k = `cupom:${normalizarCodigo(m.cupom)}`;
      await env.PEDIDOS.put(k, String((Number(await env.PEDIDOS.get(k)) || 0) + 1));
    }
  }
  await avisar(env, pagamento, m);
}

// e-mail para a loja com tudo o que precisa para separar e enviar o pedido
async function avisar(env, pagamento, m) {
  if (!env.AVISO_EMAIL) return;
  const campos = {
    _subject: `Pedido pago no site · ${m.pedido || pagamento.external_reference}`,
    _template: 'table',
    _captcha: 'false',
    Pedido: m.pedido || pagamento.external_reference,
    'Pagamento (Mercado Pago)': `${pagamento.id} · ${pagamento.payment_method_id || ''} · ${reais(pagamento.transaction_amount)}`,
    Camisas: m.itens,
    Cupom: m.cupom ? `${m.cupom} (desconto de ${reais(m.desconto)})` : 'nenhum',
    Cliente: m.nome,
    'E-mail': m.email,
    WhatsApp: m.whatsapp,
    Entrega: m.endereco,
    'Subtotal · desconto · frete · total': `${reais(m.subtotal)} · ${reais(m.desconto)} · ${reais(m.frete)} · ${reais(m.total)}`,
  };
  const r = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(env.AVISO_EMAIL)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: env.SITE_URL, Referer: `${env.SITE_URL}/` },
    body: JSON.stringify(campos),
  });
  if (!r.ok) console.error('loja: aviso por e-mail falhou', r.status);
}
