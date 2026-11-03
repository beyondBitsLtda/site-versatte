#!/usr/bin/env node
/*
  Monta o catálogo do site (seção Catálogo) a partir dos álbuns da fonte definida em catalogo.json.

  Para cada álbum da página de categoria: lê o título, decide o modelo (Retrô, Jogador ou
  Torcedor, pelas palavras do título), traduz o nome (time, temporada, titular/reserva...),
  baixa a capa e algumas fotos, converte para WebP e gera js/catalogo.js, que o site carrega.
  Preço e nome de cada modelo vêm do catalogo.json.

  Uso (na pasta do site, precisa de Node 22+ e Edge ou Chrome instalados):
    node tools/catalogo.mjs            sincroniza: baixa só as camisas novas e tira as que saíram
    node tools/catalogo.mjs --local    só regenera js/catalogo.js (preço, nomes, ajustes), sem baixar
    node tools/catalogo.mjs --simular  mostra como cada álbum seria classificado, sem gravar nada
    node tools/catalogo.mjs --tudo     baixa de novo as fotos de todas as camisas
    node tools/catalogo.mjs --limite=10  baixa no máximo 10 camisas novas (para testar)

  Fotos de camisas que saíram da fonte são apagadas de assets/catalogo/.

  O link da fonte NÃO fica no catalogo.json (o repositório e os arquivos do site são públicos).
  A ferramenta procura, nesta ordem: variável CATALOGO_FONTE (segredo no GitHub Actions),
  arquivo catalogo.local.json (só no computador, fora do Git: { "fonte": "link" }) e, por
  último, "fonte" no catalogo.json. O modo --local não precisa da fonte.
*/
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, sleep } from './navegador.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'catalogo.json');
const LOCAL_FILE = path.join(ROOT, 'catalogo.local.json');   // fora do Git (.gitignore)
const DATA_FILE = path.join(ROOT, 'js', 'catalogo.js');
const FOTOS_DIR = path.join(ROOT, 'assets', 'catalogo');
const HEADER = `// GERADO por tools/catalogo.mjs a partir de catalogo.json. Não edite aqui:
// mude catalogo.json e rode "node tools/catalogo.mjs".
window.VERSATTE_CATALOGO = `;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const CAPA_PX = 480, FOTO_PX = 720;     // lado maior das imagens geradas
const PARALELO = 3;                      // álbuns baixados ao mesmo tempo

const args = process.argv.slice(2);
const local = args.includes('--local'), simular = args.includes('--simular'), tudo = args.includes('--tudo');

/* ---------- catalogo.json ---------- */
function readConfig() {
  if (!existsSync(CONFIG_FILE)) throw new Error('não achei catalogo.json na raiz do site');
  let cfg;
  try { cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { throw new Error(`catalogo.json tem um erro de formato (${e.message}). Confira aspas e vírgulas.`); }
  // o link da fonte fica fora dos arquivos públicos: segredo CATALOGO_FONTE ou catalogo.local.json
  let doLocal = {};
  if (existsSync(LOCAL_FILE)) {
    try { doLocal = JSON.parse(readFileSync(LOCAL_FILE, 'utf8')); }
    catch (e) { throw new Error(`catalogo.local.json tem um erro de formato (${e.message}).`); }
  }
  const fontes = (process.env.CATALOGO_FONTE ? process.env.CATALOGO_FONTE.split(/\s*,\s*/) : [doLocal.fonte || cfg.fonte].flat()).filter(Boolean);
  if (!fontes.length && !local) throw new Error('informe a fonte do catálogo: variável CATALOGO_FONTE ou arquivo catalogo.local.json com { "fonte": "link" }');
  if (!Array.isArray(cfg.modelos) || !cfg.modelos.length) throw new Error('catalogo.json: a lista "modelos" está vazia');
  return {
    fontes,
    fotos: Math.max(1, cfg.fotosPorCamisa || 4),
    modelos: cfg.modelos.map(m => ({ ...m, palavras: (m.palavras || []).map(normal) })),
    excluir: (cfg.excluir || []).map(normal).filter(Boolean),
    esconder: new Set((cfg.esconder || []).map(String)),
    ajustes: cfg.ajustes || {},
    destaques: (cfg.destaques || []).map(String),
  };
}

// dados já gerados: camisas cujas fotos já estão em assets/catalogo/
function readCache() {
  const cache = new Map();
  if (!existsSync(DATA_FILE)) return cache;
  const src = readFileSync(DATA_FILE, 'utf8');
  try {
    const data = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
    for (const c of data.camisas || []) if (c.id && c.capa) cache.set(c.id, c);
  } catch {}
  return cache;
}

/* ---------- leitura do título ---------- */
// minúsculas, sem acento, hifens e travessões viram "-", espaços simples
const normal = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim();
// versão só com letras e números, para procurar palavras inteiras
const palavras = s => ` ${normal(s).replace(/[^a-z0-9]+/g, ' ').trim()} `;
const tem = (p, termo) => p.includes(` ${termo} `);

const TIMES = [
  ['Athletico Paranaense', /\bathletico\b|\batletico[- ]paranaense\b|\bparanaense\b/],
  ['Atlético Mineiro', /\batletico\b|\bgalo\b|\bmineiro athletic\b/],
  ['Flamengo', /\bflamengo\b|\bflamenco\b/],
  ['Palmeiras', /\bpalmeiras\b/],
  ['Corinthians', /\bcorinthians\b|\bcorintians\b/],
  ['São Paulo', /\bsao paulo\b|\bspfc\b/],
  ['Santos', /\bsantos\b/],
  ['Vasco', /\bvasco\b|\bda gama\b/],
  ['Fluminense', /\bfluminense\b/],
  ['Botafogo', /\bbotafogo\b/],
  ['Cruzeiro', /\bcruzeiro\b/],
  ['Grêmio', /\bgremio\b/],
  ['Internacional', /\binternacional\b|\binternational\b|\binter\b/],
  ['Bahia', /\bbahia\b/],
  ['Vitória', /\bvitoria\b|\bvictoria\b/],
  ['Santa Cruz', /\bsanta cruz\b/],
  ['Náutico', /\bnautico\b/],
  ['Sport', /\bsport\b|\brecife\b/],
  ['Fortaleza', /\bfortaleza\b/],
  ['Ceará', /\bceara\b/],
  ['Remo', /\bremo\b/],
  ['Paysandu', /\bpaysandu?\b|\bpaisandu\b/],
  ['Chapecoense', /\bchapecoense\b/],
  ['Bragantino', /\bbragantino\b/],
  ['Juventude', /\bjuventude\b/],
  ['Goiás', /\bgoias\b/],
  ['Coritiba', /\bcoritiba\b/],
  ['América Mineiro', /\bamerica mineiro\b/],
  ['Cuiabá', /\bcuiaba\b/],
  ['Mirassol', /\bmirassol\b/],
  ['Figueirense', /\bfigueirense\b/],
  ["Newell's Old Boys", /\bnewell'?s\b/],
  ['Brasil', /\bbrazil(ian)?\b|\bbrasil\b/],   // por último: "Copa do Brasil" aparece em camisas de clube
];
const TIPOS = [   // a primeira que bater vence ("third away" é a terceira camisa)
  ['Goleiro', /\bgoalkeeper\b|\bgk\b/],
  ['Quarta', /\bfourth\b|\b4th\b|\biiii\b|\b4 away\b/],
  ['Terceira', /\bthird\b|\b3rd\b|\biii\b/],
  ['Titular', /\bhome\b/],
  ['Reserva', /\baway\b|\bii\b/],
];
const EDICOES = [
  ['Edição especial', /\bspecial\b/],
  ['Edição limitada', /\blimited\b/],
  ['Comemorativa', /\bcommemorative\b|\banniversary\b|\bcentennial\b|\bcentenary\b/],
  ['Conceito', /\bconcept\b/],
  ['Reedição', /\breissue\b/],
  ['Copa do Mundo', /\bworld cup\b/],
  ['Libertadores', /\blibertadores\b/],
  ['Copa do Brasil', /\bcopa do brasil\b/],
];
const CORES = [
  ['Azul-marinho', /\bnavy\b|\bdark blue\b/], ['Azul-claro', /\blight blue\b|\bsky blue\b/],
  ['Off-white', /\boff-? ?white\b/], ['Preta', /\bblack\b/], ['Branca', /\bwhite\b/], ['Azul', /\bblue\b/],
  ['Amarela', /\byellow\b/], ['Vermelha', /\bred\b/], ['Verde', /\bgreen\b/], ['Rosa', /\bpink\b/],
  ['Roxa', /\bpurple\b/], ['Cinza', /\bgr[ae]y\b/], ['Bege', /\bbeige\b/], ['Dourada', /\bgold(en)?\b/],
  ['Laranja', /\borange\b/], ['Vinho', /\bmaroon\b|\bburgundy\b|\bwine\b/],
];
const TAMANHOS = ['P', 'M', 'G', 'GG', '2XL', '3XL', '4XL'];
const TAMANHO_DO_TITULO = { xl: 'GG', xxl: '2XL', '2xl': '2XL', xxxl: '3XL', '3xl': '3XL', xxxxl: '4XL', '4xl': '4XL', xxxxxl: '4XL', '5xl': '4XL', '6xl': '4XL' };

function temporada(t) {
  let m;
  if ((m = t.match(/\b((?:19|20)\d{2}) ?[/-] ?(\d{2,4})\b/))) return `${m[1]}/${m[2].slice(-2)}`;
  if ((m = t.match(/(?<![\d:])(\d{2}) ?[/-] ?(\d{2})(?![\d:])/))) return `${+m[1] >= 50 ? 19 : 20}${m[1]}/${m[2]}`;
  if ((m = t.match(/\b((?:19|20)\d{2})\b/))) return m[1];
  return '';
}

// "Retro Flamengo 00/01 Home S-XXL" -> { time: "Flamengo", detalhe: "2000/01 · Titular", max: "2XL" }
function lerTitulo(titulo) {
  const t = normal(titulo);
  const separado = t.replace(/([a-z])(\d)/g, '$1 $2');   // "Bahia13/14" -> "bahia 13/14"
  const time = (TIMES.find(([, re]) => re.test(separado)) || [])[0] || '';
  const tipo = (TIPOS.find(([, re]) => re.test(t)) || [])[0] || '';
  const edicoes = EDICOES.filter(([, re]) => re.test(t)).map(([n]) => n);
  if (time === 'Brasil') { const i = edicoes.indexOf('Copa do Brasil'); if (i >= 0) edicoes.splice(i, 1); }
  const cores = [];
  let resto = t;
  for (const [nome, re] of CORES) if (re.test(resto)) { cores.push(nome); resto = resto.replace(re, ' '); }
  const apelido = (titulo.match(/["“]([^"”]{2,30})["”]/) || [])[1] || '';
  const patrocinio = /\bno (ads|sponsors?)\b|\bwithout sponsors?\b/.test(t) ? 'sem patrocínios'
    : /\bsponsors?\b/.test(t) ? 'com patrocínios' : '';
  const detalhe = [temporada(t), tipo, ...edicoes, apelido, ...cores.slice(0, 2), patrocinio].filter(Boolean).join(' · ');
  const tam = [...t.matchAll(/(?<![a-z])(x{1,5}l|[2-6]xl)(?![a-z])/g)].map(m => TAMANHO_DO_TITULO[m[1]]).filter(Boolean).pop();
  return { time, detalhe, max: tam || '', temporada: temporada(t) };
}

function classificar(album, cfg) {
  const p = palavras(album.titulo);
  if (cfg.excluir.some(termo => tem(p, termo))) return null;
  const modelo = cfg.modelos.find(m => m.palavras.some(termo => tem(p, termo))) || cfg.modelos.find(m => !m.palavras.length);
  return modelo ? modelo.id : null;
}

/* ---------- fonte (páginas de categoria e álbuns) ---------- */
const decode = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function pegar(url, referer, tipo = 'text') {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return tipo === 'text' ? await res.text() : Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (tentativa >= 3) throw new Error(`${e.message} em ${url}`);
      await sleep(1500 * tentativa);
    }
  }
}

async function lerCategoria(fonte) {
  const base = new URL(fonte);
  const albuns = [];
  for (let pagina = 1, total = 1; pagina <= total; pagina++) {
    const url = new URL(base); url.searchParams.set('page', pagina);
    const html = await pegar(url.href);
    total = +(html.match(/pagination-span">\s*\d+\s*\/\s*(\d+)/) || [])[1] || total;
    const re = /class="album__main"\s+title="([^"]*)"\s+href="\/albums\/(\d+)[^"]*"[\s\S]*?data-src="([^"]+)"[\s\S]*?album__photonumber">(\d+)</g;
    let n = 0;
    for (const m of html.matchAll(re)) { albuns.push({ id: m[2], titulo: decode(m[1]).trim(), capa: m[3], qtd: +m[4] }); n++; }
    process.stdout.write(`\r  lendo a fonte: página ${pagina} de ${total} (${albuns.length} álbuns)`);
    if (!n) break;
    await sleep(300);
  }
  process.stdout.write('\n');
  return { origem: base.origin, albuns };
}

// fotos do álbum, na ordem, no tamanho médio (~800px)
async function fotosDoAlbum(origem, id) {
  const html = await pegar(`${origem}/albums/${id}?uid=1`, `${origem}/`);
  const dirs = [...html.matchAll(/data-src="(https:\/\/[^"]+)\/big\.(jpe?g|png|webp)"/g)].map(m => `${m[1]}/medium.${m[2]}`);
  return [...new Set(dirs)];
}
const medio = url => url.replace(/\/(small|square|big|medium)\.(jpe?g|png|webp)$/, '/medium.$2');

/* ---------- principal ---------- */
const cfg = readConfig();
const cache = readCache();

// 1. lista de álbuns da fonte (ou, no modo --local, o que já foi baixado)
let lista;
if (local) {
  lista = [...cache.values()].map(c => ({ id: c.id, titulo: c.titulo }));
  console.log(`Modo local: ${lista.length} camisas já baixadas, sem consultar a fonte.`);
} else {
  lista = [];
  for (const fonte of cfg.fontes) {
    const { origem, albuns } = await lerCategoria(fonte);
    lista.push(...albuns.map(a => ({ ...a, origem })));
  }
}

// 2. classifica, traduz e tira repetidos (mesmo título) e escondidos
const vistos = new Set(), fora = [], semTime = [];
const camisas = [];
for (const a of lista) {
  const chave = normal(a.titulo);
  if (vistos.has(chave)) continue;
  vistos.add(chave);
  const ajuste = cfg.ajustes[a.id] || {};
  const modelo = ajuste.modelo || classificar(a, cfg);
  if (!modelo) { fora.push(a.titulo); continue; }
  if (cfg.esconder.has(a.id)) continue;
  const lido = lerTitulo(a.titulo);
  // álbum sem time e sem temporada no título não é camisa (ex.: "......", capa de seção)
  if (!ajuste.modelo && !lido.time && !lido.temporada) { fora.push(a.titulo); continue; }
  const time = ajuste.time || lido.time;
  if (!time) semTime.push(`${a.id}  ${a.titulo}`);
  camisas.push({
    ...a, modelo,
    time: time || 'Outros',
    detalhe: ajuste.detalhe ?? (lido.time ? lido.detalhe : a.titulo.replace(/\bS ?[-\u2010-\u2015] ?\S*XL\S*/i, '').trim()),
    max: ajuste.max || lido.max,
  });
}

const porModelo = id => camisas.filter(c => c.modelo === id).length;
console.log(`Camisas no catálogo: ${camisas.length} (${cfg.modelos.map(m => `${m.nome} ${porModelo(m.id)}`).join(', ')}) · fora do catálogo: ${fora.length}`);

if (simular) {
  for (const m of cfg.modelos) {
    console.log(`\n== ${m.nome} (R$ ${m.preco.toFixed(2).replace('.', ',')})`);
    for (const c of camisas.filter(c => c.modelo === m.id)) console.log(`  ${c.id}  ${c.time.padEnd(20)} ${c.detalhe.padEnd(48)} ${c.max.padEnd(4)} ← ${c.titulo}`);
  }
  console.log(`\n== Fora do catálogo (palavras de "excluir")\n  ${fora.join('\n  ')}`);
  if (semTime.length) console.log(`\n== Sem time reconhecido (aparecem como "Outros"; corrija em "ajustes")\n  ${semTime.join('\n  ')}`);
  process.exit(0);
}

// 3. baixa as fotos das camisas novas
const fotosOk = c => c?.capa && [c.capa, ...(c.fotos || [])].every(f => existsSync(path.join(ROOT, f)));
const limite = +(args.find(a => a.startsWith('--limite=')) || '').split('=')[1] || Infinity;   // para testes
const baixar = local ? [] : camisas.filter(c => tudo || !fotosOk(cache.get(c.id))).slice(0, limite);
let falhas = 0;
if (baixar.length) {
  console.log(`Baixando ${baixar.length} camisa(s) nova(s)...`);
  const browser = await openBrowser();
  let feitas = 0;
  const fila = [...baixar];
  const trabalhador = async () => {
    for (let c; (c = fila.shift());) {
      try {
        const doAlbum = c.qtd ? await fotosDoAlbum(c.origem, c.id) : [];
        const capaUrl = medio(c.capa);
        const urls = [capaUrl, ...doAlbum.filter(u => u !== capaUrl)].slice(0, cfg.fotos);
        const dir = path.join(FOTOS_DIR, c.id);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        const fotos = [];
        for (const [i, url] of urls.entries()) {
          const original = await pegar(url, `${c.origem}/`, 'buffer');
          if (i === 0) writeFileSync(path.join(dir, 'capa.webp'), await browser.toWebp(original, CAPA_PX, .72));
          writeFileSync(path.join(dir, `${i + 1}.webp`), await browser.toWebp(original, FOTO_PX, .74));
          fotos.push(`assets/catalogo/${c.id}/${i + 1}.webp`);
        }
        cache.set(c.id, { id: c.id, capa: `assets/catalogo/${c.id}/capa.webp`, fotos });
      } catch (e) {
        falhas++;
        console.log(`\n  ${c.id} falhou: ${e.message}`);
      }
      process.stdout.write(`\r  ${++feitas} de ${baixar.length} baixadas`);
      await sleep(150);
    }
  };
  try { await Promise.all(Array.from({ length: PARALELO }, trabalhador)); }
  finally { browser.close(); }
  process.stdout.write('\n');
}

// 4. gera js/catalogo.js (na ordem da fonte: as mais recentes primeiro)
const saida = camisas.filter(c => fotosOk(cache.get(c.id))).map(c => {
  const { capa, fotos } = cache.get(c.id);
  const nome = [c.time === 'Outros' ? '' : c.time, c.detalhe.replaceAll(' · ', ' ')].filter(Boolean).join(' ');
  return { id: c.id, modelo: c.modelo, time: c.time, detalhe: c.detalhe, nome, max: c.max, titulo: c.titulo, capa, fotos };
});
const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const modelos = cfg.modelos.map(({ id, nome, preco }) => ({ id, nome, preco }));
// camisas fixas nos destaques da home (o site completa com as mais recentes de cada modelo)
const noCatalogo = new Set(saida.map(c => c.id));
const destaques = cfg.destaques.filter(id => noCatalogo.has(id));
const semDestaque = cfg.destaques.filter(id => !noCatalogo.has(id));
if (semDestaque.length) console.log(`Destaques que não estão no catálogo (ignorados): ${semDestaque.join(', ')}`);
writeFileSync(DATA_FILE, `${HEADER}{\n  "atualizado": "${hoje}",\n  "tamanhos": ${JSON.stringify(TAMANHOS)},\n  "modelos": ${JSON.stringify(modelos)},\n  "destaques": ${JSON.stringify(destaques)},\n  "camisas": [\n${saida.map(c => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n};\n`);

// 5. apaga fotos de camisas que saíram da fonte (ou foram escondidas)
if (!local && existsSync(FOTOS_DIR)) {
  const ficam = new Set(saida.map(c => c.id));
  let removidas = 0;
  for (const nome of readdirSync(FOTOS_DIR)) if (!ficam.has(nome)) { rmSync(path.join(FOTOS_DIR, nome), { recursive: true, force: true }); removidas++; }
  if (removidas) console.log(`Removidas as fotos de ${removidas} camisa(s) que saíram do catálogo.`);
}

console.log(`\njs/catalogo.js gerado: ${saida.length} camisa(s) · ${cfg.modelos.map(m => `${m.nome} ${saida.filter(c => c.modelo === m.id).length} (R$ ${m.preco.toFixed(2).replace('.', ',')})`).join(', ')}.`);
if (semTime.length) console.log(`${semTime.length} camisa(s) sem time reconhecido aparecem como "Outros" (veja com --simular e corrija em "ajustes").`);
process.exitCode = falhas ? 1 : 0;
