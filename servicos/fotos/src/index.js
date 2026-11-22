// ============================================================
//  FOTOS DO CATÁLOGO · Cloudflare Worker (versatte-fotos)
//  As fotos das camisas que não são baixadas para o site vêm por aqui: o Worker busca a foto
//  no fornecedor (que só entrega para quem vem da própria loja) e guarda no cache da Cloudflare.
//
//  GET /f/<fornecedor>/<código>/<tamanho>.<ext>
//    fornecedor  1, 2... (a ordem do segredo FORNECEDORES, a mesma de CATALOGO_FONTE)
//    código      o código da foto no fornecedor (letras a-f e números)
//    tamanho     s = pequena (cards do catálogo) · m = média (janela da camisa)
//  Ex.: /f/2/cdca6b24f8/m.jpg
//
//  Segredo FORNECEDORES: os nomes das lojas, na ordem, separados por vírgula (nunca no código).
//  ORIGENS (vars): sites que podem mostrar as fotos; pedido de outro site recebe 403.
// ============================================================
const TAMANHO = { s: 'small', m: 'medium' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const UM_ANO = 31536000;

const vazio = (status, extra = {}) => new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...extra } });

export default {
  async fetch(req, env, ctx) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return vazio(405, { Allow: 'GET, HEAD' });
    const url = new URL(req.url);
    if (url.pathname === '/saude') return Response.json({ ok: true, servico: 'versatte-fotos' });
    const m = url.pathname.match(/^\/f\/(\d{1,2})\/([0-9a-f]{6,40})\/([sm])\.(jpe?g|png|webp)$/i);
    if (!m) return vazio(404);

    // só o site usa (sem "referer", como em alguns navegadores e apps, também passa)
    const ref = req.headers.get('referer');
    const permitidos = String(env.ORIGENS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (ref && permitidos.length && !permitidos.some(o => ref === o || ref.startsWith(o + '/') || ref.startsWith(o + ':'))) return vazio(403);

    const lojas = String(env.FORNECEDORES || '').split(',').map(s => s.trim()).filter(Boolean);
    const loja = lojas[+m[1] - 1];
    if (!loja || !/^[a-z0-9-]+$/i.test(loja)) return vazio(404);

    // cache da Cloudflare (a chave é só o caminho: a mesma foto serve todo mundo)
    const cache = caches.default;
    const chave = new Request(`${url.origin}${url.pathname}`);
    const guardada = await cache.match(chave);
    if (guardada) return req.method === 'HEAD' ? new Response(null, { headers: guardada.headers }) : guardada;

    const origem = `https://photo.yupoo.com/${loja}/${m[2].toLowerCase()}/${TAMANHO[m[3]]}.${m[4].toLowerCase()}`;
    let up;
    try {
      up = await fetch(origem, { headers: { Referer: `https://${loja}.x.yupoo.com/`, 'User-Agent': UA, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' } });
    } catch {
      return vazio(502);
    }
    const tipo = up.headers.get('content-type') || '';
    if (!up.ok || !tipo.startsWith('image/')) return vazio(up.status === 404 ? 404 : 502);

    const resp = new Response(up.body, {
      headers: {
        'Content-Type': tipo,
        'Cache-Control': `public, max-age=${UM_ANO}, immutable`,
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
      },
    });
    ctx.waitUntil(cache.put(chave, resp.clone()));
    return req.method === 'HEAD' ? new Response(null, { headers: resp.headers }) : resp;
  },
};
