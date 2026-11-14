#!/usr/bin/env node
/*
  Traz as cartas do Versatte Cards (o jogo) para o site: a carta 3D da home e as cartas do teaser.

  Abre o jogo num navegador headless (Edge/Chrome, sem instalar nada), gera o HTML de cada carta com
  o próprio js/cards.js do jogo e grava no site:
    - js/vitrine-cartas.js        cartas da página versatte-cards.html (INTRO e SECOES abaixo)
    - index.html                  a carta da home, entre <!-- carta 3D --> e <!-- /carta 3D -->
    - assets/cards/*.webp         escudos (512 px) e fotos dos jogadores (600 px) usados nas cartas
    - assets/img/beyond-bits-light.webp   logo clara da Beyond Bits (do jogo, assets/logo-beyond.png)
  O visual das cartas fica em css/vcard.css (cópia do CSS do jogo, escopo .vcard).

  Uso (na pasta do site):  node tools/vitrine-cartas.mjs "<pasta do Versatte_card_game>"

  Só entram cartas de CLUBES (escudos) e de JOGADORES COM FOTO DE LICENÇA LIVRE (domínio público ou
  Creative Commons). A lista LIVRES abaixo é a trava: uma carta com imagem fora dela faz a ferramenta
  parar. Origem, autor e licença de cada imagem: assets/cards/LEIA-ME.txt (e os créditos no rodapé
  do teaser). Fotos "todos os direitos reservados" ou de origem desconhecida do jogo NÃO vão para o site.
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
// animação de abertura do teaser (no celular entram só as 12 primeiras)
const INTRO = ['clube-cru-u2', 'jog-pele-prime', 'clube-fla-camp', 'jog-zico-prime', 'clube-pal-camp', 'jog-garrincha-prime', 'clube-bot-hist', 'jog-ronaldo-prime',
  'clube-flu-hist', 'jog-cafu', 'clube-san-hist', 'jog-rivellino', 'clube-gre-u2', 'jog-falcao', 'clube-int-u2', 'jog-ceni', 'clube-sao-u2'];
// cartas de cada seção do teaser (a ordem importa: pacote e raridades vão de Comum a Especial; no clube, a 1ª é o goleiro)
const SECOES = {
  pacote: ['clube-gre', 'jog-fred', 'clube-san-hist', 'jog-zico-prime'],
  raridades: ['clube-cam', 'jog-alex', 'jog-garrincha', 'jog-pele-prime'],
  colecoes: ['clube-fla-camp', 'clube-pal-camp', 'jog-ronaldo-prime', 'jog-nilton-santos'],
  clube: ['jog-castilho', 'jog-luis-pereira', 'jog-falcao', 'jog-rivellino', 'jog-pele'],
  escudo: ['clube-bot-hist'],
  troca: ['jog-renato', 'jog-dinamite'],
};
// imagens liberadas para o site (licença livre; ver assets/cards/LEIA-ME.txt)
const LIVRES = new Set([
  ...['bot', 'cam', 'cru', 'fla', 'flu', 'gre', 'int', 'pal', 'san', 'sao'].map(c => `clubes/clube-${c}.png`),
  ...['ademir', 'alex', 'cafu', 'castilho', 'ceni', 'clodoaldo', 'dinamite', 'falcao', 'fred', 'garrincha-prime', 'garrincha', 'lugano', 'luis-pereira',
    'nilton-santos', 'pele-prime', 'pele', 'renato', 'rivellino', 'ronaldo-prime', 'ruschel', 'zico-prime', 'zico'].map(j => `jogadores/jog-${j}.jpg`),
]);
const UIDS = [...new Set([HOME, ...INTRO, ...Object.values(SECOES).flat()])];
if (!existsSync(path.join(JOGO, 'js', 'cards.js'))) { console.error('Informe a pasta do jogo: node tools/vitrine-cartas.mjs "<pasta do Versatte_card_game>"'); process.exit(1); }
const fora = UIDS.filter(u => !/^(clube|jog)-/.test(u));
if (fora.length) { console.error('Só cartas de clubes e jogadores: ' + fora.join(', ')); process.exit(1); }

// página temporária dentro do jogo (servida só aqui, não grava nada no jogo)
const pagina = `<!doctype html><html><head><meta charset="utf-8"></head><body><canvas id="fx" hidden></canvas><script type="module">
try {
  const { CARD_BY_UID } = await import('./js/data.js');
  const { cardHTML } = await import('./js/cards.js');
  const uids = ${JSON.stringify(UIDS)};
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

  // trava: toda imagem usada precisa estar em LIVRES (e toda carta precisa ter a sua imagem)
  const usadas = new Set();
  for (const [u, h] of Object.entries(html)) {
    const imgs = [...h.matchAll(/src="assets\/cartas\/([^"]+)"/g)].map(m => m[1]);
    if (!imgs.length) throw new Error(`${u}: carta sem imagem (no site só entram escudos e jogadores com foto)`);
    for (const i of imgs) { if (!LIVRES.has(i)) throw new Error(`${u}: a imagem ${i} não está na lista de licenças livres (LIVRES)`); usadas.add(i); }
  }

  // HTML do jogo → HTML do site
  const conv = (h, lazy) => h
    .replace(/class="card ([^"]*)"/, (_, c) => `class="vcard ${c.split(/\s+/).filter(x => x && !['s-lg', 'is-live'].includes(x)).join(' ')}"`)
    .replace(/ data-uid="[^"]*"/, '')
    .replace(/assets\/cartas\/(?:clubes|jogadores)\/((?:clube|jog)-[a-z-]+)\.(?:png|jpg)/g, 'assets/cards/$1.webp')
    .replace(/assets\/logo-versatte\.png/g, 'assets/img/logo-vs.webp')
    .replace(/<span>CARDS<\/span>/, '<span>Cards</span>')
    .replace(/ loading="lazy"/g, lazy ? ' loading="lazy"' : '')
    .replace(/opacity="(\d\.\d{3})\d+"/g, 'opacity="$1"')
    .replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();

  // imagens (escudos com fundo transparente; fotos dos jogadores) e logo clara da Beyond Bits
  mkdirSync(path.join(ROOT, 'assets', 'cards'), { recursive: true });
  for (const i of usadas) {
    const foto = i.startsWith('jogadores/');
    const out = await b.toWebp(readFileSync(path.join(JOGO, 'assets', 'cartas', i)), foto ? 600 : 512, foto ? .82 : .88);
    writeFileSync(path.join(ROOT, 'assets', 'cards', path.basename(i).replace(/\.(png|jpg)$/, '.webp')), out);
  }
  writeFileSync(path.join(ROOT, 'assets', 'img', 'beyond-bits-light.webp'), await b.toWebp(readFileSync(path.join(JOGO, 'assets', 'logo-beyond.png')), 700, .9));

  // teaser: cartas por uid (abaixo da dobra com carregamento sob demanda) + listas
  const naIntro = new Set(INTRO);
  const cartas = Object.fromEntries(UIDS.filter(u => u !== HOME || naIntro.has(u)).map(u => [u, conv(html[u], !naIntro.has(u))]));
  writeFileSync(path.join(ROOT, 'js', 'vitrine-cartas.js'),
    `// GERADO por tools/vitrine-cartas.mjs a partir do jogo (Versatte_card_game, js/cards.js): cartas da página versatte-cards.html.
// Só escudos (domínio público) e jogadores com foto de licença livre; créditos em assets/cards/LEIA-ME.txt e no rodapé do teaser.
window.VERSATTE_VITRINE = {
  intro: ${JSON.stringify(INTRO)},
  secoes: ${JSON.stringify(SECOES)},
  cartas: {
${Object.entries(cartas).map(([u, h]) => `    ${JSON.stringify(u)}: ${JSON.stringify(h)}`).join(',\n')}
  }
};
`);

  // home
  const idx = path.join(ROOT, 'index.html');
  const s = readFileSync(idx, 'utf8');
  const a = s.indexOf('<!-- carta 3D -->'), z = s.indexOf('<!-- /carta 3D -->');
  if (a < 0 || z < a) throw new Error('index.html: não achei os marcadores <!-- carta 3D --> e <!-- /carta 3D -->');
  writeFileSync(idx, s.slice(0, a + '<!-- carta 3D -->'.length) + conv(html[HOME], true) + s.slice(z));
  console.log(`ok: ${Object.keys(cartas).length} cartas no teaser, ${usadas.size} imagens (assets/cards/) e a carta ${HOME} na home.`);
} finally {
  b.close(); server.close();
}
