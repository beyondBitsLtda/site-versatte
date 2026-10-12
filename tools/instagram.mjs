#!/usr/bin/env node
/*
  Importa posts do Instagram da Versatte para a vitrine.

  Para cada post: baixa todas as fotos do carrossel na resolução original
  (1440px para a prévia e 1080px para a galeria) e atualiza legenda,
  curtidas, número de comentários e data em js/posts.js.

  Uso (na pasta do site, precisa de Node 22+ e Edge ou Chrome instalados):
    node tools/instagram.mjs                      atualiza todos os posts de js/posts.js
    node tools/instagram.mjs <link ou código>...  adiciona/atualiza posts específicos

  Exemplo:
    node tools/instagram.mjs https://www.instagram.com/p/DeSt8_9DErk/

  Depois de adicionar um post novo, edite em js/posts.js os campos de texto
  da vitrine (tag, caps, script e name). Eles nunca são sobrescritos.
  Para tirar um post da vitrine, apague o bloco dele em js/posts.js.
*/
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'js', 'posts.js');
const POSTS_DIR = path.join(ROOT, 'assets', 'posts');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- posts.js ---------- */
const HEADER = `// Posts da vitrine. Gerado por tools/instagram.mjs (veja as instruções lá).
// Pode editar à mão: tag, caps, script, name e msg (mensagem opcional para o direct).
// Mantenha o formato JSON (aspas duplas, sem vírgula sobrando).
window.VERSATTE_POSTS = `;

function readPosts() {
  if (!existsSync(DATA_FILE)) return [];
  const src = readFileSync(DATA_FILE, 'utf8');
  const start = src.indexOf('[');
  const end = src.lastIndexOf(']');
  return JSON.parse(src.slice(start, end + 1));
}
const writePosts = posts => writeFileSync(DATA_FILE, `${HEADER}${JSON.stringify(posts, null, 2)};\n`);

const codeFrom = s => (s.match(/(?:\/p\/|\/reel\/)?([A-Za-z0-9_-]{8,})\/?(?:\?.*)?$/) || [])[1];

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
const posts = readPosts();
const args = process.argv.slice(2);
const codes = args.length ? args.map(codeFrom).filter(Boolean) : posts.map(p => p.code);
if (!codes.length) { console.log('Nenhum post para importar. Passe um link: node tools/instagram.mjs https://www.instagram.com/p/CODIGO/'); process.exit(0); }

const browser = await openBrowser();
let failures = 0;
try {
  for (const code of codes) {
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
      let post = posts.find(p => p.code === code);
      if (!post) {
        post = { code, tag: 'Destaque', caps: 'Nova', script: 'camisa', name: 'Nova camisa' };
        posts.unshift(post);
        console.log('\n  post novo: edite tag, caps, script e name em js/posts.js');
      }
      Object.assign(post, {
        images, thumbs,
        caption: embed.caption || post.caption || '',
        likes: embed.likes ?? meta.likes ?? post.likes ?? 0,
        comments: meta.comments ?? post.comments ?? 0,
        date: meta.date || post.date || null,
      });
      writePosts(posts);
      console.log(`ok (${images.length} foto${images.length > 1 ? 's' : ''}, ${post.likes} curtidas, ${post.comments} comentários)`);
    } catch (e) {
      failures++;
      console.log(`falhou: ${e.message}`);
    }
  }
} finally {
  browser.close();
}
process.exitCode = failures ? 1 : 0;
