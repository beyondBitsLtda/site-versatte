#!/usr/bin/env node
/*
  Importa os posts do Instagram da Versatte para a seção "Novidades do Insta" do site.

  Dois modos:
  1. AUTOMÁTICO (feed): com a variável INSTAGRAM_FEED apontando para o feed JSON do
     Behold (behold.so, que lê o Instagram pela API oficial), pega os 4 posts mais
     recentes do perfil, baixa as fotos e gera js/posts.js. É o modo usado pelo
     GitHub Actions (.github/workflows/novidades.yml), que roda sozinho a cada 6 horas.
  2. MANUAL (sem feed): os posts são os links listados em camisas.json; a ferramenta lê
     o embed público de cada post (fotos do carrossel, legenda, curtidas e data).

  Nos dois modos, camisas.json também guarda textos opcionais por post (etiqueta,
  titulo, cursiva, nome, mensagem): se o link do post estiver lá, o card usa esses textos;
  se não estiver, o card mostra o começo da legenda.

  Uso (na pasta do site, precisa de Node 22+; o modo manual também precisa de Edge ou Chrome):
    node tools/instagram.mjs          baixa só os posts novos e regenera o site
    node tools/instagram.mjs --tudo   baixa de novo todos (atualiza curtidas e fotos)
  Modo automático no PowerShell:
    $env:INSTAGRAM_FEED = "https://feeds.behold.so/SEU-FEED"; node tools/instagram.mjs

  Fotos de posts que saíram da seção são apagadas de assets/posts/.
*/
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, sleep } from './navegador.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'js', 'posts.js');
const POSTS_DIR = path.join(ROOT, 'assets', 'posts');
const FEED = (process.argv.find(a => a.startsWith('--feed=')) || '').slice(7) || process.env.INSTAGRAM_FEED || '';
const NOVIDADES = 4;                       // quantos posts recentes aparecem no modo automático
const GRUPO_FEED = 'Novidades do Insta';

/* ---------- camisas.json (entrada) e js/posts.js (saída) ---------- */
const CONFIG_FILE = path.join(ROOT, 'camisas.json');
const HEADER = `// GERADO por tools/instagram.mjs (feed do Instagram + textos de camisas.json). Não edite aqui:
// rode "node tools/instagram.mjs".
window.VERSATTE_CAMISAS = `;

const codeFrom = s => {
  const t = String(s || '').trim();
  return (t.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel)\/([A-Za-z0-9_-]+)/) || t.match(/^([A-Za-z0-9_-]{8,})$/) || [])[1];
};

function readConfig() {
  if (!existsSync(CONFIG_FILE)) {
    if (FEED) return [];  // no modo automático o camisas.json só traz textos opcionais
    throw new Error('não achei camisas.json na raiz do site');
  }
  let cfg;
  try { cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { throw new Error(`camisas.json tem um erro de formato (${e.message}). Confira aspas e vírgulas.`); }
  return Object.entries(cfg)
    .filter(([grupo, lista]) => !grupo.startsWith('_') && Array.isArray(lista))
    .map(([grupo, lista]) => ({
      grupo,
      camisas: lista.map((item, i) => {
        const c = typeof item === 'string' ? { link: item } : item;
        const code = codeFrom(c.link);
        if (!code) throw new Error(`"${grupo}", item ${i + 1}: link do Instagram inválido (${c.link})`);
        return { ...c, code };
      }),
    }));
}

// dados já baixados (aceita o formato antigo, VERSATTE_POSTS, e o atual)
function readCache() {
  const cache = new Map();
  if (!existsSync(DATA_FILE)) return cache;
  const src = readFileSync(DATA_FILE, 'utf8');
  try {
    const data = JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));
    const posts = data.flatMap(d => (Array.isArray(d.camisas) ? d.camisas : [d]));
    for (const p of posts) if (p.code && p.images?.length) cache.set(p.code, p);
  } catch {}
  return cache;
}

// roda dentro do embed: percorre o carrossel e devolve fotos, legenda e curtidas
const SCRAPE = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const parse = srcset => srcset.split(/,\\s*(?=https?:)/).map(s => { const [url, w] = s.trim().split(/\\s+/); return { url, w: parseInt(w, 10) || 0 }; })
    .filter(c => !/[?&]stp=c\\d+\\.\\d+\\.\\d+\\.\\d+a_/.test(c.url));               // ignora recortes quadrados
  const found = new Map();                                                            // id da foto -> candidatos
  // o carrossel só mantém ~3 fotos no DOM; coleta a cada passo, mantendo a ordem
  const collect = () => document.querySelectorAll('img[srcset]').forEach(img => {
    const set = parse(img.getAttribute('srcset'));
    if (!set.length || !set.some(c => c.w >= 1000)) return;
    const id = (set[0].url.match(/\\/(\\d+_\\d+_\\d+)_n\\./) || [])[1] || set[0].url;
    const prev = found.get(id) || [];
    found.set(id, prev.length >= set.length ? prev : set);
  });
  const nextBtn = () => document.querySelector('button[aria-label="Avançar"], button[aria-label="Next"]');
  collect();
  for (let i = 0; i < 20 && nextBtn(); i++) { nextBtn().click(); await sleep(700); collect(); }
  const pick = (set, max) => set.filter(c => c.w <= max).sort((a, b) => b.w - a.w)[0] || set.sort((a, b) => a.w - b.w)[0];
  const slides = [...found.values()].map(set => ({ large: pick(set, 1440).url, small: pick(set, 1080).url }));
  const cap = document.querySelector('.Caption');
  let caption = '';
  if (cap) {
    const c = cap.cloneNode(true);
    c.querySelectorAll('.CaptionUsername, .CaptionComments').forEach(n => n.remove());
    c.querySelectorAll('br').forEach(br => br.replaceWith('\\n'));
    caption = c.textContent.replace(/\\u200b/g, '').replace(/\\n{3,}/g, '\\n\\n').trim();
  }
  const likesEl = document.querySelector('[data-log-event="likeCountClick"]');
  const likes = likesEl ? parseInt(likesEl.textContent.replace(/\\D/g, ''), 10) || 0 : null;
  const dots = document.querySelectorAll('._acnb').length;
  return { slides, caption, likes, dots };
})()`;

async function scrapeEmbed(browser, code) {
  await browser.send('Page.navigate', { url: `https://www.instagram.com/p/${code}/embed/captioned/` });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const ready = await browser.evaluate(`!!document.querySelector('.Caption, img[srcset]')`).catch(() => false);
    if (ready) break;
  }
  await sleep(1500);
  return browser.evaluate(SCRAPE);
}

// a página do post (como robô de link) traz número de comentários e data na og:description
async function scrapeMeta(code) {
  try {
    const html = await (await fetch(`https://www.instagram.com/p/${code}/`, { headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' } })).text();
    const desc = (html.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || '';
    const d = desc.replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
    const num = re => { const m = d.match(re); return m ? parseInt(m[1].replace(/\D/g, ''), 10) : null; };
    const dateTxt = (d.match(/ on ([A-Z][a-z]+ \d{1,2}, \d{4})/) || [])[1];
    const date = dateTxt ? new Date(`${dateTxt} 12:00 UTC`).toISOString().slice(0, 10) : null;
    return { likes: num(/([\d.,]+) likes?/), comments: num(/([\d.,]+) comments?/), date };
  } catch { return {}; }
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar imagem`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

// baixa e escolhe a extensão pelo tipo da imagem (o feed pode entregar JPG ou WebP)
async function downloadAs(url, dir, nome) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar imagem`);
  const tipo = res.headers.get('content-type') || '';
  const ext = /webp/.test(tipo) ? 'webp' : /png/.test(tipo) ? 'png' : 'jpg';
  writeFileSync(path.join(dir, `${nome}.${ext}`), Buffer.from(await res.arrayBuffer()));
  return `${nome}.${ext}`;
}

/* ---------- modo automático: feed JSON do Behold (API oficial do Instagram) ---------- */
const midiaDe = (m, tam) => m.sizes?.[tam]?.mediaUrl || m.sizes?.full?.mediaUrl || (m.mediaType === 'VIDEO' ? m.thumbnailUrl : m.mediaUrl);
const dataBR = ts => (ts ? new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : null);

async function lerFeed() {
  const res = await fetch(FEED);
  if (!res.ok) throw new Error(`o feed respondeu HTTP ${res.status}`);
  const feed = await res.json();
  const posts = (Array.isArray(feed) ? feed : feed.posts || []).slice(0, NOVIDADES);
  if (!posts.length) throw new Error('o feed veio sem posts');
  return posts.map(p => {
    const code = codeFrom(p.permalink);
    const midias = p.mediaType === 'CAROUSEL_ALBUM' && p.children?.length ? p.children : [p];
    const slides = midias.map(m => ({ large: midiaDe(m, 'large'), small: midiaDe(m, 'medium') })).filter(s => s.large);
    return {
      code, slides, video: p.mediaType === 'VIDEO',
      caption: p.caption || '', likes: p.likeCount ?? null, comments: p.commentsCount ?? null, date: dataBR(p.timestamp),
    };
  }).filter(p => p.code && p.slides.length);
}

/* ---------- principal ---------- */
const tudo = process.argv.includes('--tudo');
const grupos = readConfig();
// textos opcionais por post (de qualquer grupo do camisas.json)
const textos = new Map(grupos.flatMap(g => g.camisas.map(c => [c.code, c])));
const cache = readCache();
const imagesOk = p => p?.images?.length && p.images.every(f => existsSync(path.join(ROOT, f)));
let failures = 0;
let lista = grupos;  // grupos e posts na ordem em que aparecem no site

if (FEED) {
  let recentes;
  try { recentes = await lerFeed(); }
  catch (e) {
    // sem o feed, o site continua com os posts que já tem (não apaga nada)
    console.log(`Não consegui ler o feed do Instagram: ${e.message}. O site continua com os posts atuais.`);
    process.exit(1);
  }
  lista = [{ grupo: GRUPO_FEED, camisas: recentes.map(p => ({ ...textos.get(p.code), code: p.code })) }];
  for (const p of recentes) {
    const antigo = cache.get(p.code);
    const dados = { caption: p.caption, likes: p.likes ?? antigo?.likes ?? null, comments: p.comments ?? antigo?.comments ?? null, date: p.date || antigo?.date || null, ...(p.video ? { video: true } : {}) };
    if (!tudo && imagesOk(antigo)) { cache.set(p.code, { ...antigo, ...dados }); continue; }
    process.stdout.write(`• ${p.code} ... `);
    try {
      const dir = path.join(POSTS_DIR, p.code);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const images = [], thumbs = [];
      for (const [i, s] of p.slides.entries()) {
        images.push(`assets/posts/${p.code}/${await downloadAs(s.large, dir, `${i + 1}`)}`);
        thumbs.push(s.small && s.small !== s.large ? `assets/posts/${p.code}/${await downloadAs(s.small, dir, `${i + 1}-thumb`)}` : images[i]);
      }
      cache.set(p.code, { code: p.code, images, thumbs, ...dados });
      console.log(`ok (${images.length} foto${images.length > 1 ? 's' : ''})`);
    } catch (e) {
      failures++;
      console.log(`falhou: ${e.message}`);
    }
  }
}

/* ---------- modo manual: posts listados no camisas.json ---------- */
const codes = [...new Set(lista.flatMap(g => g.camisas.map(c => c.code)))];
const baixar = FEED ? [] : codes.filter(code => tudo || !imagesOk(cache.get(code)));
if (baixar.length) {
  const browser = await openBrowser();
  try {
    for (const code of baixar) {
      process.stdout.write(`• ${code} ... `);
      try {
        const [embed, meta] = [await scrapeEmbed(browser, code), await scrapeMeta(code)];
        if (!embed.slides.length) throw new Error('nenhuma foto encontrada (o post é público?)');
        if (embed.dots && embed.dots !== embed.slides.length) console.log(`\n  aviso: o carrossel tem ${embed.dots} itens, baixei ${embed.slides.length} (vídeos não entram)`);
        const dir = path.join(POSTS_DIR, code);
        rmSync(dir, { recursive: true, force: true }); // remove fotos antigas do post
        mkdirSync(dir, { recursive: true });
        const images = [], thumbs = [];
        for (const [i, s] of embed.slides.entries()) {
          await download(s.large, path.join(dir, `${i + 1}.jpg`));
          images.push(`assets/posts/${code}/${i + 1}.jpg`);
          if (s.small === s.large) { thumbs.push(images[i]); continue; } // o Instagram só tem uma versão
          await download(s.small, path.join(dir, `${i + 1}-1080.jpg`));
          thumbs.push(`assets/posts/${code}/${i + 1}-1080.jpg`);
        }
        const antigo = cache.get(code) || {};
        cache.set(code, {
          code, images, thumbs,
          caption: embed.caption || antigo.caption || '',
          likes: embed.likes ?? meta.likes ?? antigo.likes ?? 0,
          comments: meta.comments ?? antigo.comments ?? 0,
          date: meta.date || antigo.date || null,
        });
        console.log(`ok (${images.length} foto${images.length > 1 ? 's' : ''}, ${cache.get(code).likes} curtidas)`);
      } catch (e) {
        failures++;
        console.log(`falhou: ${e.message}`);
      }
    }
  } finally {
    browser.close();
  }
} else if (!FEED) {
  console.log('Nenhum post novo para baixar (use --tudo para atualizar todos).');
}

// monta js/posts.js na ordem do feed (ou do camisas.json, no modo manual)
const semTexto = [];
const saida = lista.map(({ grupo, camisas }) => ({
  grupo,
  camisas: camisas.filter(c => cache.has(c.code)).map(c => {
    const d = cache.get(c.code);
    if (!c.titulo) semTexto.push(`${grupo}: https://www.instagram.com/p/${c.code}/`);
    const caps = c.titulo || '';     // sem título, o card mostra o começo da legenda
    const script = c.cursiva || '';
    return {
      code: c.code,
      link: `https://www.instagram.com/p/${c.code}/`,
      tag: c.etiqueta || '',
      caps, script,
      name: c.nome || [caps, script].filter(Boolean).join(' '),
      ...(c.mensagem ? { msg: c.mensagem } : {}),
      ...(d.video ? { video: true } : {}),
      images: d.images, thumbs: d.thumbs,
      caption: d.caption, likes: d.likes, comments: d.comments, date: d.date,
    };
  }),
}));
writeFileSync(DATA_FILE, `${HEADER}${JSON.stringify(saida, null, 2)};\n`);

// apaga fotos de posts que saíram da seção
if (existsSync(POSTS_DIR)) {
  for (const nome of readdirSync(POSTS_DIR)) {
    if (!codes.includes(nome)) { rmSync(path.join(POSTS_DIR, nome), { recursive: true, force: true }); console.log(`removido: assets/posts/${nome} (saiu da seção)`); }
  }
}

const total = saida.reduce((n, g) => n + g.camisas.length, 0);
console.log(`\njs/posts.js gerado (${FEED ? 'modo automático, pelo feed' : 'modo manual, pelo camisas.json'}): ${saida.map(g => `${g.grupo} (${g.camisas.length})`).join(', ')} · ${total} post(s).`);
if (semTexto.length) console.log(`Posts sem textos no camisas.json (o card mostra o começo da legenda; para um título próprio, adicione o link lá):\n  ${semTexto.join('\n  ')}`);
process.exitCode = failures ? 1 : 0;
