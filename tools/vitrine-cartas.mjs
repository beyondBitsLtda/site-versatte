#!/usr/bin/env node
/*
  Traz as cartas do Versatte Cards (o jogo) para o site: a carta 3D da home e as cartas do teaser.

  Abre o jogo num navegador headless (Edge/Chrome, sem instalar nada), gera o HTML de cada carta com
  o próprio js/cards.js do jogo e grava no site:
    - js/vitrine-cartas.js        cartas da página versatte-cards.html (na ordem de CARTAS abaixo)
    - index.html                  a carta da home, entre <!-- carta 3D --> e <!-- /carta 3D -->
    - assets/cards/clube-*.webp   escudos usados nas cartas (512 px)
    - assets/img/beyond-bits-light.webp   logo clara da Beyond Bits (do jogo, assets/logo-beyond.png)
  O visual das cartas fica em css/vcard.css (cópia do CSS do jogo, escopo .vcard).

  Uso (na pasta do site):  node tools/vitrine-cartas.mjs "<pasta do Versatte_card_game>"

  Clubes usam o escudo (domínio público, ver assets/cards/LEIA-ME.txt). Estádios, mascotes e Juízo
  Final usam a arte desenhada pelo jogo, sem as fotos (fotos de terceiros não vão para o site).
*/
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, sleep } from './navegador.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JOGO = path.resolve(process.argv[2] || '');
const HOME = 'clube-cru-u2';   // carta 3D da home (#card-game)
const CARTAS = ['clube-cru-u2', 'clube-fla-camp', 'jf-doutor-rebaixamento', 'clube-bot-hist', 'estadio-maracana', 'clube-pal-camp', 'masc-cru-neon',
  'clube-flu-hist', 'jf-urubu-infinito', 'clube-gre-u2', 'estadio-mineirao', 'clube-san-hist', 'masc-pal-supremo', 'clube-int-u2', 'jf-raposa-sombria', 'clube-sao-u2', 'clube-cam-u2'];
if (!existsSync(path.join(JOGO, 'js', 'cards.js'))) { console.error('Informe a pasta do jogo: node tools/vitrine-cartas.mjs "<pasta do Versatte_card_game>"'); process.exit(1); }

// página temporária dentro do jogo (servida só aqui, não grava nada no jogo)
const pagina = `<!doctype html><html><head><meta charset="utf-8"></head><body><canvas id="fx" hidden></canvas><script type="module">
try {
  const { CARD_BY_UID } = await import('./js/data.js');
  const { IMAGENS } = await import('./js/imagens.js');
  const { cardHTML } = await import('./js/cards.js');
  const uids = ${JSON.stringify([...new Set([HOME, ...CARTAS])])};
  for (const u of uids) if (!u.startsWith('clube-')) IMAGENS[u] = '';
  window.__html = Object.fromEntries(uids.map(u => [u, CARD_BY_UID[u] ? cardHTML(CARD_BY_UID[u], { size: 'lg' }) : null]));
} catch (e) { window.__erro = String(e.stack || e); }
</script></body></html>`;
const tipos = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/__vitrine.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(pagina); }
  const f = path.join(JOGO, p);
  if (!f.startsWith(JOGO) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); res.end(await readFile(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const b = await openBrowser();
try {
  await b.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/__vitrine.html` });
  let html;
  for (let i = 0; i < 60 && !(html = await b.evaluate('window.__html || (window.__erro && "ERRO")')); i++) await sleep(250);
  if (!html || html === 'ERRO') throw new Error('o jogo não gerou as cartas: ' + (await b.evaluate('window.__erro || ""')));
  const falta = Object.entries(html).filter(([, h]) => !h).map(([u]) => u);
  if (falta.length) throw new Error('cartas que não existem no jogo: ' + falta.join(', '));

  // HTML do jogo → HTML do site
  const conv = (h, lazy) => h
    .replace(/class="card ([^"]*)"/, (_, c) => `class="vcard ${c.split(/\s+/).filter(x => x && !['s-lg', 'is-live'].includes(x)).join(' ')}"`)
    .replace(/ data-uid="[^"]*"/, '')
    .replace(/assets\/cartas\/clubes\/(clube-[a-z]+)\.png/g, 'assets/cards/$1.webp')
    .replace(/assets\/logo-versatte\.png/g, 'assets/img/logo-vs.webp')
    .replace(/<span>CARDS<\/span>/, '<span>Cards</span>')
    .replace(/ loading="lazy"/g, lazy ? ' loading="lazy"' : '')
    .replace(/opacity="(\d\.\d{3})\d+"/g, 'opacity="$1"')
    .replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();

  // escudos e logo clara da Beyond Bits
  mkdirSync(path.join(ROOT, 'assets', 'cards'), { recursive: true });
  for (const f of [...new Set(Object.values(html).join('').match(/clube-[a-z]+\.png/g) || [])]) {
    writeFileSync(path.join(ROOT, 'assets', 'cards', f.replace('.png', '.webp')), await b.toWebp(readFileSync(path.join(JOGO, 'assets', 'cartas', 'clubes', f)), 512, .88));
  }
  writeFileSync(path.join(ROOT, 'assets', 'img', 'beyond-bits-light.webp'), await b.toWebp(readFileSync(path.join(JOGO, 'assets', 'logo-beyond.png')), 700, .9));

  // teaser
  const lista = CARTAS.map(u => conv(html[u], false));
  writeFileSync(path.join(ROOT, 'js', 'vitrine-cartas.js'),
    `// GERADO por tools/vitrine-cartas.mjs a partir do jogo (Versatte_card_game, js/cards.js): HTML das cartas da página versatte-cards.html.
// Clubes com escudo (domínio público, ver assets/cards/LEIA-ME.txt); estádios, mascotes e Juízo Final com a arte própria do jogo.
window.VERSATTE_VITRINE = [\n${lista.map(h => `  ${JSON.stringify(h)}`).join(',\n')}\n];\n`);

  // home
  const idx = path.join(ROOT, 'index.html');
  const s = readFileSync(idx, 'utf8');
  const a = s.indexOf('<!-- carta 3D -->'), z = s.indexOf('<!-- /carta 3D -->');
  if (a < 0 || z < a) throw new Error('index.html: não achei os marcadores <!-- carta 3D --> e <!-- /carta 3D -->');
  writeFileSync(idx, s.slice(0, a + '<!-- carta 3D -->'.length) + conv(html[HOME], true) + s.slice(z));
  console.log(`ok: ${lista.length} cartas no teaser (js/vitrine-cartas.js) e a carta ${HOME} na home.`);
} finally {
  b.close(); server.close();
}
