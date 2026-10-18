#!/usr/bin/env node
/*
  Importa os posts do Instagram da Versatte para a galeria do site.

  O que aparece na galeria é definido no arquivo camisas.json (raiz do site):
  cada grupo (ex.: "Camisas destaque") tem a lista de camisas, com o link do
  post e os textos do card. Esta ferramenta lê esse arquivo, baixa as fotos
  de cada post (todas as do carrossel, na resolução original) com legenda,
  curtidas, comentários e data, e gera js/posts.js, que o site carrega.

  Uso (na pasta do site, precisa de Node 22+ e Edge ou Chrome instalados):
    node tools/instagram.mjs          baixa só os posts novos e regenera o site
    node tools/instagram.mjs --tudo   baixa de novo todos (atualiza curtidas e fotos)

  Fluxo para trocar as camisas:
    1. edite camisas.json (adicione, tire ou reordene os links e textos);
    2. rode: node tools/instagram.mjs
    3. publique (commit + push).
  Fotos de posts que saíram do camisas.json são apagadas de assets/posts/.
*/
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'js', 'posts.js');
const POSTS_DIR = path.join(ROOT, 'assets', 'posts');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- camisas.json (entrada) e js/posts.js (saída) ---------- */
const CONFIG_FILE = path.join(ROOT, 'camisas.json');
const HEADER = `// GERADO por tools/instagram.mjs a partir de camisas.json. Não edite aqui:
// mude camisas.json e rode "node tools/instagram.mjs".
window.VERSATTE_CAMISAS = `;

const codeFrom = s => {
  const t = String(s || '').trim();
  return (t.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel)\/([A-Za-z0-9_-]+)/) || t.match(/^([A-Za-z0-9_-]{8,})$/) || [])[1];
};

function readConfig() {
  if (!existsSync(CONFIG_FILE)) throw new Error('não achei camisas.json na raiz do site');
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

/* ---------- navegador headless (Edge ou Chrome) ---------- */
function findBrowser() {
  const c = [
    process.env.BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
  ].filter(Boolean);
  const found = c.find(p => existsSync(p));
  if (!found) throw new Error('Não achei Edge nem Chrome. Defina a variável BROWSER com o caminho do navegador.');
  return found;
}

async function openBrowser() {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = path.join(tmpdir(), `vs-ig-${port}`);
  mkdirSync(profile, { recursive: true });
  const proc = spawn(findBrowser(), ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=600,1300'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some(t => t.type === 'page')) break; } catch {}
    await sleep(200);
  }
  const page = targets?.find(t => t.type === 'page');
  if (!page) throw new Error('O navegador headless não respondeu.');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  let id = 0; const pending = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  return {
    send,
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'erro no navegador');
      return r.result?.result?.value;
    },
    close() { try { ws.close(); } catch {} proc.kill(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 800); },
  };
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

/* ---------- principal ---------- */
const tudo = process.argv.includes('--tudo');
const grupos = readConfig();
const cache = readCache();
const codes = [...new Set(grupos.flatMap(g => g.camisas.map(c => c.code)))];
const imagesOk = p => p?.images?.length && p.images.every(f => existsSync(path.join(ROOT, f)));
const baixar = codes.filter(code => tudo || !imagesOk(cache.get(code)));

let failures = 0;
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
} else {
  console.log('Nenhum post novo para baixar (use --tudo para atualizar todos).');
}

// monta js/posts.js na ordem do camisas.json
const semTexto = [];
const saida = grupos.map(({ grupo, camisas }) => ({
  grupo,
  camisas: camisas.filter(c => cache.has(c.code)).map(c => {
    const d = cache.get(c.code);
    if (!c.titulo) semTexto.push(`${grupo}: ${c.link}`);
    const caps = c.titulo || 'Camisa';
    const script = c.cursiva || '';
    return {
      code: c.code,
      link: `https://www.instagram.com/p/${c.code}/`,
      tag: c.etiqueta || grupo,
      caps, script,
      name: c.nome || [caps, script].filter(Boolean).join(' '),
      ...(c.mensagem ? { msg: c.mensagem } : {}),
      images: d.images, thumbs: d.thumbs,
      caption: d.caption, likes: d.likes, comments: d.comments, date: d.date,
    };
  }),
}));
writeFileSync(DATA_FILE, `${HEADER}${JSON.stringify(saida, null, 2)};\n`);

// apaga fotos de posts que saíram do camisas.json
if (existsSync(POSTS_DIR)) {
  for (const nome of readdirSync(POSTS_DIR)) {
    if (!codes.includes(nome)) { rmSync(path.join(POSTS_DIR, nome), { recursive: true, force: true }); console.log(`removido: assets/posts/${nome} (saiu do camisas.json)`); }
  }
}

const total = saida.reduce((n, g) => n + g.camisas.length, 0);
console.log(`\njs/posts.js gerado: ${saida.map(g => `${g.grupo} (${g.camisas.length})`).join(', ')} · ${total} camisa(s).`);
if (semTexto.length) console.log(`Faltam textos (titulo/cursiva/etiqueta) em camisas.json para:\n  ${semTexto.join('\n  ')}`);
process.exitCode = failures ? 1 : 0;
