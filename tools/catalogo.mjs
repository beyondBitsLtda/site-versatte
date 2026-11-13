#!/usr/bin/env node
/*
  Monta o catálogo do site (seção Catálogo) a partir dos álbuns da fonte definida em catalogo.json.

  Lê uma página de categoria da fonte para cada liga do catalogo.json ("ligas"). Para cada álbum:
  lê o título, decide o modelo (Retrô, Jogador ou Torcedor, pelas palavras do título), traduz o
  nome (time, temporada, titular/reserva...), decide a liga (pelo time; seleções vão para
  "Seleções"; time desconhecido fica na liga da categoria), baixa a capa e algumas fotos,
  converte para WebP e gera js/catalogo.js, que o site carrega.
  Preço e nome de cada modelo e o nome de cada liga vêm do catalogo.json.

  Uso (na pasta do site, precisa de Node 22+ e Edge ou Chrome instalados):
    node tools/catalogo.mjs            sincroniza: baixa só as camisas novas e tira as que saíram
    node tools/catalogo.mjs --local    só regenera js/catalogo.js (preço, nomes, ligas, ajustes), sem baixar
    node tools/catalogo.mjs --simular  mostra como cada álbum seria classificado, sem gravar nada
    node tools/catalogo.mjs --tudo     baixa de novo as fotos de todas as camisas
    node tools/catalogo.mjs --limite=10  baixa no máximo 10 camisas novas (para testar)
    node tools/catalogo.mjs --minutos=90 para de baixar depois de 90 minutos e grava o que já
                                         baixou (o resto entra na próxima vez)

  Fotos de camisas que saíram da fonte são apagadas de assets/catalogo/.

  O link da fonte NÃO fica no catalogo.json (o repositório e os arquivos do site são públicos).
  A ferramenta procura, nesta ordem: variável CATALOGO_FONTE (segredo no GitHub Actions),
  arquivo catalogo.local.json (só no computador, fora do Git: { "fonte": "link" }) e, por
  último, "fonte" no catalogo.json. Com "ligas" no catalogo.json, a fonte só informa o endereço
  da loja; as categorias lidas são as de cada liga. O modo --local não precisa da fonte.

  Vários fornecedores: um link por fornecedor, na ordem (no segredo, separados por vírgula; no
  catalogo.local.json, { "fonte": ["link 1", "link 2"] }). Em cada liga, "categoria" é do 1º
  fornecedor, "categoria2" do 2º e assim por diante. A mesma camisa nos dois (mesmo modelo, time
  e detalhe) aparece uma vez só, a do fornecedor que vem antes. Se faltar o link de um fornecedor
  que tem categorias, a ferramenta para sem mudar nada (senão as camisas dele seriam apagadas).
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
  // ligas: { id, nome, categoria, categoria2... } (categoria = número da página de categoria do 1º
  // fornecedor, categoria2 = do 2º e assim por diante; cada uma pode ser uma lista)
  // categorias[i] = categorias do fornecedor i + 1 (na ordem dos links da fonte)
  const porFornecedor = l => {
    const cats = [];
    for (const [k, v] of Object.entries(l)) {
      const m = k.match(/^categoria(\d*)$/);
      if (m) cats[(+m[1] || 1) - 1] = [v].flat().filter(Boolean).map(String);
    }
    return Array.from(cats, c => c || []);
  };
  const ligas = (cfg.ligas || []).map(l => ({ id: String(l.id || ''), nome: String(l.nome || l.id || ''), emblema: String(l.emblema || ''), categorias: porFornecedor(l) }));
  if (ligas.some(l => !l.id)) throw new Error('catalogo.json: toda liga precisa de "id"');
  // sem o link de um fornecedor, as camisas dele "sairiam da fonte" e as fotos seriam apagadas: para antes
  const fornecedores = Math.max(0, ...ligas.map(l => l.categorias.findLastIndex(c => c.length) + 1));
  if (!local && fornecedores > fontes.length) throw new Error(`catalogo.json tem categorias de ${fornecedores} fornecedores, mas a fonte tem ${fontes.length} link(s). Ponha os links na mesma ordem (categoria = 1º link, categoria2 = 2º...), separados por vírgula no segredo CATALOGO_FONTE ou como lista em "fonte" no catalogo.local.json.`);
  return {
    fontes, ligas,
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

/* Times de cada liga (a chave é o "id" da liga no catalogo.json). Na lista de uma liga, o primeiro
   que bater vence. Ordem da busca: times da liga da categoria do álbum, seleções, times das outras
   ligas (Brasil por último: nomes curtos como "inter", "atletico" e "sport" pegariam times de fora).
   A fonte usa apelidos nos títulos: M-U (Manchester United), LWP (Liverpool), YW (Juventus),
   Celtics (Celtic), riverbed (River Plate), Leyard Victory (Al-Nassr) etc. */
const CLUBES = {
  inglaterra: [
    ['Manchester United', /\bm-?u\b|\bman(chester)? (united|utd)\b|\bmufc\b/],
    ['Manchester City', /\bman(chester)? city\b|\bmcfc\b/],
    ['Liverpool', /\bliverpool\b|\blfc\b|\blwp\b|\bwlp\b/],
    ['Arsenal', /\barsenal\b/],
    ['Chelsea', /\bchelsea\b/],
    ['Tottenham', /\btottenham\b|\bspurs\b|\bhotspurs?\b/],
    ['Newcastle', /\bnewcastle\b/],
    ['Aston Villa', /\baston villa\b/],
    ['Everton', /\beverton\b/],
    ['Leeds United', /\bleeds\b/],
    ['Leicester', /\bleicester\b/],
    ['Nottingham Forest', /\bnottingham\b/],
    ['Brighton', /\bbrighton\b/],
    ['West Ham', /\bwest ham\b/],
    ['Crystal Palace', /\bcrystal palace\b/],
    ['Fulham', /\bfulham\b/],
    ['Brentford', /\bbrentford\b/],
    ['Bournemouth', /\bbournemouth\b/],
    ['Wolverhampton', /\bwolves\b|\bwolverhampton\b/],
    ['Southampton', /\bsouthampton\b/],
    ['Sunderland', /\bsunderlandl?\b/],
    ['Burnley', /\bburnley\b/],
    ['Ipswich', /\bipswich\b/],
    ['Norwich', /\bnorwich\b/],
    ['West Bromwich', /\bwest brom(wich)?\b/],
    ['Stoke City', /\bstoke\b/],
    ['Watford', /\bwatford\b/],
    ['Middlesbrough', /\bmiddlesbrough\b/],
    ['Sheffield Wednesday', /\bsheffield wednesday\b/],
    ['Sheffield United', /\bsheffield (united|utd)\b/],
    ['QPR', /\bqpr\b|\bqueens park rangers\b/],
    ['Derby County', /\bderby county\b/],
    ['Hull City', /\bhull\b/],
    ['Coventry', /\bcoventry\b/],
    ['Wycombe', /\bwycombe\b/],
    ['Wrexham', /\bwrexham\b/],
    ['Blackburn Rovers', /\bblackburn\b/],
    ['AFC Richmond', /\brichmond\b/],
    ['Birmingham City', /\bbirmingham\b/],
    ['Millwall', /\bmillwall\b/],
    ['Bolton', /\bbolton\b/],
    ['Bradford City', /\bbradford\b/],
    ['Plymouth Argyle', /\bplymouth\b/],
    ['Portsmouth', /\bportsmouth\b/],
    ['Preston', /\bpreston\b/],
    ['Doncaster Rovers', /\bdoncaster\b/],
  ],
  espanha: [
    ['Real Madrid', /\breal madrid\b/],
    ['Atlético de Madrid', /\batletico (de )?madrid\b|\batleti\b/],
    ['Barcelona', /\bbarcelona\b|\bbarca\b/],
    ['Real Betis', /\bbetis\b/],
    ['Valencia', /\bvalencia\b/],
    ['Sevilla', /\bsevilla\b|\bseville\b/],
    ['Athletic Bilbao', /\bathletic (club|bilbao)\b|\bbilbao\b/],
    ['Real Sociedad', /\breal sociedad\b/],
    ['Villarreal', /\bvillarreal\b/],
    ['Deportivo La Coruña', /\bcoruna\b|\bdeportivo deportivo\b/],
    ['Real Zaragoza', /\bzaragoza\b/],
    ['Rayo Vallecano', /\brayo\b|\bvallecano\b/],
    ['Málaga', /\bmalaga\b/],
    ['Celta de Vigo', /\bcelta\b/],
    ['Córdoba', /\bcordoba\b/],
    ['Tenerife', /\btenerife\b/],
    ['Las Palmas', /\blas palmas\b/],
    ['Osasuna', /\bosasuna\b/],
    ['Espanyol', /\bespanyol\b/],
    ['Real Valladolid', /\bvalladolid\b/],
    ['Granada', /\bgranada\b/],
    ['Real Oviedo', /\boviedo\b/],
    ['Sporting Gijón', /\bgijon\b/],
    ['Girona', /\bgirona\b/],
    ['Cádiz', /\bcadiz\b/],
    ['Mallorca', /\bmallorca\b/],
    ['Albacete', /\balbacete\b/],
    ['Racing Santander', /\bsantander\b/],
    ['Almería', /\balmeria\b/],
    ['Leganés', /\bleganes\b/],
    ['Getafe', /\bgetafe\b/],
    ['Murcia', /\bmurcia\b/],
    ['Recreativo Huelva', /\brecreativo\b|\bhuelva\b/],
    ['Alavés', /\balaves\b/],
    ['Levante', /\blevante\b/],
    ['Elche', /\belche\b/],
    ['Eibar', /\beibar\b/],
    ['Algeciras', /\balgeciras\b/],
    ['Cultural Leonesa', /\bcultural leonesa\b/],
    ['Ceuta', /\bceuta\b/],
    ['Burgos', /\bburgos\b/],
    ['Cartagena', /\bcartagena\b/],
    ['Compostela', /\bcompostela\b/],
    ['Hércules', /\bhercules\b/],
  ],
  italia: [
    ['Inter de Milão', /\binter(nazionale)?\b(?! miami)/],   // antes do Milan ("inter milan")
    ['Milan', /\bmilan\b|\bac (?=\d|centenary)/],   // "Retro AC 06/07"
    ['Juventus', /\bjuventus\b|\bjuve\b|\byw\b/],
    ['Roma', /\broma\b|\brome\b|\broman\b/],
    ['Napoli', /\bnapoli\b|\bnaples\b/],
    ['Lazio', /\blazio\b/],
    ['Fiorentina', /\bfiorentina\b|\bflorence\b/],
    ['Atalanta', /\batalanta\b|\batlanta\b(?! united)/],
    ['Parma', /\bparma\b|\bpamma\b/],
    ['Venezia', /\bvenezia\b|\bvenice(fc)?\b/],
    ['Bologna', /\bbologna\b/],
    ['Palermo', /\bpalermo\b/],
    ['Lecce', /\blecce\b/],
    ['Como', /\bcomo\b/],
    ['Bari', /\bbari\b/],
    ['Genoa', /\bgenoa\b/],
    ['Sampdoria', /\bsampdoria\b/],
    ['Torino', /\btorino\b/],
    ['Udinese', /\budinese\b/],
    ['Cagliari', /\bcagliari\b/],
    ['Sassuolo', /\bsassuolo\b/],
    ['Hellas Verona', /\bhellas\b|(?<!chievo )\bverona\b/],
    ['Monza', /\bmonza\b/],
    ['Cremonese', /\bcremonese\b/],
    ['Pisa', /\bpisa\b/],
    ['Brescia', /\bbrescia\b/],
    ['Padova', /\bpadova\b/],
    ['Perugia', /\bperugia\b/],
  ],
  alemanha: [
    ['Bayern de Munique', /\bbayern\b/],
    ['Borussia Dortmund', /\bdortmund\b|\bbvb\b/],
    ['Bayer Leverkusen', /\bleverkusen\b/],
    ['Borussia Mönchengladbach', /\bmoe?nchengladbach\b|\bgladbach\b/],
    ['RB Leipzig', /\bleipzig\b/],
    ['Schalke 04', /\bschalke\b/],
    ['Werder Bremen', /\bbremen\b/],
    ['Colônia', /\bkoe?ln\b|\bcologne\b/],
    ['St. Pauli', /\b(st|sankt)\.? ?pauli\b/],
    ['Eintracht Frankfurt', /\bfrankfurt\b/],
    ['Freiburg', /\bfreiburg\b/],
    ['Hamburgo', /\bhamburg(er)?\b/],
    ['Wolfsburg', /\bwolfsburg\b/],
    ['Stuttgart', /\bstuttgart\b/],
    ['Union Berlin', /\bunion berlin\b/],
    ['Hertha Berlim', /\bhertha\b/],
    ['Nürnberg', /\bnu?e?rnberg\b/],
    ['Fortuna Düsseldorf', /\bdu?e?sseldorf\b/],
    ['Hannover 96', /\bhannover\b/],
    ['Hansa Rostock', /\brostock\b/],
    ['Kaiserslautern', /\bkaiserslautern\b/],
    ['Karlsruher SC', /\bkarlsruher?\b/],
    ['MSV Duisburg', /\bduisburg\b/],
    ['1860 Munique', /\btsv 1860\b|\b1860 munich\b/],
    ['Holstein Kiel', /\bholstein kiel\b/],
    ['Dynamo Dresden', /\bdresden\b/],
    ['VfL Bochum', /\bbochum\b/],
    ['Wattenscheid', /\bwattenscheid\b/],
  ],
  franca: [
    ['PSG', /\bpsg\b|\bparis saint[- ]?germain\b|\bparis sg\b/],
    ['Olympique de Marseille', /\bmarseille\b/],
    ['Lyon', /\blyon(nais)?\b/],
    ['Lille', /\blille\b/],
    ['Monaco', /\bmonaco\b/],
    ['Strasbourg', /\bstrasbourg\b/],
    ['Lens', /\blens\b/],
    ['Metz', /\bmetz\b/],
    ['Nantes', /\bnantes\b/],
    ['Rennes', /\brennes\b|\bstade rennais\b/],
    ['Bordeaux', /\bbordeaux\b/],
    ['Saint-Étienne', /\b(saint|st)[- ]?etienne\b/],
    ['Nice', /\bogc nice\b/],
    ['Paris FC', /\bparis fc\b/],
    ['Reims', /\breims\b/],
    ['Brest', /\bbrest(ois)?\b/],
    ['Toulouse', /\btoulouse\b/],
    ['Cannes', /\bcannes\b/],
  ],
  portugal: [
    ['Benfica', /\bbenfica\b/],
    ['Porto', /\bporto\b/],
    ['Sporting', /\bsporting\b(?!.*\bgijon\b)/],
    ['Braga', /\bbraga\b/],
    ['Vitória de Guimarães', /\bguimaraes\b|\bvitoria sc\b/],
    ['Famalicão', /\bfamalicao\b/],
    ['Estoril', /\bestoril\b/],
    ['Boavista', /\bboavista\b/],
    ['Marítimo', /\bmaritimo\b/],
    ['Alverca', /\balverca\b/],
    ['Torreense', /\btorreense\b/],
  ],
  holanda: [
    ['Ajax', /\bajax\b/],
    ['Feyenoord', /\bfeyenoord\b/],
    ['PSV', /\bpsv\b|\beindhoven\b/],
    ['AZ Alkmaar', /\balkmaar\b/],
    ['Twente', /\btwente\b/],
    ['Groningen', /\bgroningen\b/],
  ],
  argentina: [
    ['Boca Juniors', /\bboca\b/],
    ['River Plate', /\briver ?(plate|bed)\b/],
    ['Racing', /\bracing\b(?!.*\bsantander\b)/],
    ['Independiente', /\bindependiente\b(?! del valle)/],
    ["Newell's Old Boys", /\bnewell'?s?\b/],
    ['San Lorenzo', /\bsan lorenzo\b/],
    ['Estudiantes', /\bestudiantes\b/],
    ['Vélez Sarsfield', /\bvelez\b/],
    ['Rosario Central', /\brosario central\b/],
    ['Talleres', /\btalleres\b/],
    ['Argentinos Juniors', /\bargentinos juniors\b/],
    ['Lanús', /\blanus\b/],
    ['Belgrano', /\bbelgrano\b/],
  ],
  mexico: [
    ['Chivas', /\bchivas\b|\bguadalajara\b/],
    ['América', /(?<!copa )\bamericas?\b(?! mineiro)/],
    ['Tigres', /\btigres\b|\btigers\b/],
    ['Monterrey', /\bmonterr?ey\b/],
    ['Cruz Azul', /\bcruz azul\b|\bcross\b/],
    ['Pumas', /\bpumas\b|\bunam\b/],
    ['Atlas', /\batlas\b/],
    ['Toluca', /\btoluca\b/],
    ['Santos Laguna', /\bsantos laguna\b/],
    ['Pachuca', /\bpachuca\b/],
    ['Atlante', /\batlante\b/],
    ['León', /\bclub leon\b/],
    ['FC Juárez', /\bjuarez\b/],
    ['Necaxa', /\bnecaxa\b/],
    ['Tijuana', /\btijuana\b|\bxolos\b/],
  ],
  eua: [
    ['Inter Miami', /\bmiami\b/],
    ['LA Galaxy', /\bgalaxy\b/],
    ['LAFC', /\blafc\b|\blos angeles fc\b/],
    ['New York City', /\bnew york city\b|\bnycfc\b|\byork city\b/],
    ['New York Red Bulls', /\bred bulls\b/],
    ['Atlanta United', /\batlanta united\b/],
    ['Charlotte FC', /\bcharlotte\b/],
    ['St. Louis City', /\bst\.? louis\b/],
    ['Cincinnati', /\bcincinnati\b/],
    ['CF Montréal', /\bmontreal?\b/],
    ['Seattle Sounders', /\bseattle\b/],
    ['Orlando City', /\borlando\b/],
    ['Toronto FC', /\btoronto\b/],
    ['Columbus Crew', /\bcolumbus\b/],
    ['Portland Timbers', /\bportland\b/],
    ['Austin FC', /\baustin\b/],
    ['Chicago Fire', /\bchicago\b/],
    ['San Diego FC', /\bsan diego\b/],
    ['Vancouver Whitecaps', /\bvancouver\b/],
  ],
  chile: [
    ['Colo-Colo', /\bcolo[- ]?colo\b/],
    ['Universidad de Chile', /\b(universi(ty|dad)|univ) (of|de) chile\b|\bu de chile\b/],
    ['Universidad Católica', /\bcatholic\b|\bcatolica\b/],
    ["O'Higgins", /\bo'? ?higgins\b/],
    ['Cobreloa', /\bcobreloa\b/],
  ],
  escocia: [
    ['Celtic', /\bceltics?\b/],
    ['Rangers', /\brangers\b/],
    ['Hibernian', /\bhibernian\b/],
    ['Hearts', /\bhearts\b/],
    ['Aberdeen', /\baberdeen\b/],
    ['Dundee United', /\bdundee (united|utd)\b/],
  ],
  arabia: [
    ['Al-Nassr', /\bal[- ]?nassr\b|\b(riyadh|leyard) victory\b/],
    ['Al-Hilal', /\bal[- ]?hilal\b|\b(riyadh|leyard) crescent\b/],
    ['Al-Ittihad', /\bal[- ]?ittihad\b/],
    ['Al-Ahli', /\bal[- ]?ahli\b/],
  ],
  outras: [
    ['Galatasaray', /\bgalata(saray)?\b/],
    ['Fenerbahçe', /\bfenerbahce\b/],
    ['Besiktas', /\bbesiktas\b/],
    ['Trabzonspor', /\btrabzonspor\b/],
    ['Olympiacos', /\bolympiak?c?os\b/],
    ['Panathinaikos', /\bpanathinaikos\b/],
    ['Estrela Vermelha', /\bcrvena zvezda\b|\bred star belgrade\b/],
    ['Legia Varsóvia', /\blegia\b/],
    ['AIK', /\baik\b/],
    ['Red Bull Salzburg', /\bsalzburg\b/],
    ['Peñarol', /\bpenarol\b/],
    ['Atlético Nacional', /\batletico nacional\b|\bnational athletic\b/],
    ['Al Ahly', /\bal[- ]?ahly\b|\bcairo na[ct]ional\b/],
    ['Nacional', /\bnacional\b|\buruguay(an)? national\b/],   // Club Nacional (Uruguai), depois dos outros "nacional"
    ['Millonarios', /\bmillonarios\b|\bmillionaires?\b/],
    ['Olimpia', /\bolimpia\b|\bolympia\b/],
    ['Urawa Reds', /\burawa\b/],
    ['Kashima Antlers', /\bkashima\b/],
    ['Kashiwa Reysol', /\bkashiwa\b/],
    ['Kawasaki Frontale', /\bkawasaki\b/],
    ['Kyoto Sanga', /\bkyoto\b/],
    ['Nagoya Grampus', /\bnagoya\b/],
    ['Gamba Osaka', /\bgamba\b/],
    ['Cerezo Osaka', /\bcerezo\b/],
    ['FC Tokyo', /\bfc tokyo\b/],
    ['Sanfrecce Hiroshima', /\bsanfrecce\b|\bhiroshima\b/],
    ['Shimizu S-Pulse', /\bshimizu\b/],
    ['Vissel Kobe', /\bvissel\b|\bkobe\b/],
    ['Yokohama F. Marinos', /\byokohama\b/],
    ['Avispa Fukuoka', /\bavispa\b|\bfukuoka\b/],
    ['AEK Atenas', /\baek\b/],
    ['Aris', /\baris thessaloniki\b/],
    ['Dínamo Bucareste', /\bdinamo (bucarest|bucharest|bucuresti)\b/],
    ['Cerro Porteño', /\bcerro porteno\b/],
    ['Club Brugge', /\bbrugge\b|\bbruges\b/],
    ['Brøndby', /\bbr[øo]ndby\b/],
    ['Rosenborg', /\brosenborg\b/],
    ['Bohemians', /\bbohemians?\b/],
    ['Derry City', /\bderry\b/],
    ['MC Alger', /\bmc alger\b/],
    ['Montevideo City Torque', /\bmontevideo city\b/],
    ['Junior Barranquilla', /^junior\b|\bjunior (fc|barranquilla)\b/],
  ],
  brasil: [
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
  ],
};
// seleções (liga "selecoes"); a Seleção Brasileira vem depois dos clubes porque "Copa do Brasil"
// aparece em camisas de clube
const SELECOES = [
  ['Brasil', /\bbrazil(ian)?\b|\bbrasil\b/],
  ['Argentina', /\bargentin(a|e)\b/],
  ['Alemanha', /\bgerman(y)?\b|\bdeutschland\b/],
  ['Espanha', /\bspain\b|\bspanish\b|\bespana\b/],
  ['França', /\bfrance\b|\bfrench\b/],
  ['Itália', /\bital(y|ia|ian)\b/],
  ['Inglaterra', /\bengland\b/],
  ['Portugal', /\bportugal\b|\bportuguese\b/],
  ['Holanda', /\bnetherlands?\b|\bholland\b|\bdutch\b/],
  ['Bélgica', /\bbelgi(um|an)\b/],
  ['Croácia', /\bcroa(tia|cia)\b/],
  ['Uruguai', /(?<!\bnacional )\burugua(y|yan)\b(?! (nacional|national))/],
  ['Colômbia', /\bcolomb(ia|ian)\b|\bcolumbia\b/],
  ['México', /\bmexic(o|an)\b/],
  ['Estados Unidos', /\busa\b|\busmnt\b|\bunited states\b/],
  ['Japão', /\bjapan(ese)?\b/],
  ['Coreia do Sul', /\b(south )?korea(n)?\b/],
  ['Chile', /(?<!\b(of|de) )\bchile\b/],
  ['Escócia', /\bscotland\b|\bscottish\b/],
  ['Irlanda do Norte', /\bnorthern ireland\b/],
  ['Irlanda', /\bireland\b|\birish\b/],
  ['País de Gales', /\bwales\b|\bwelsh\b/],
  ['Nigéria', /\bnigeria\b/],
  ['Senegal', /\bsenegal\b/],
  ['Equador', /\becuador\b/],
  ['Mali', /\bmali\b/],
  ['Noruega', /\bnorway\b/],
  ['Guatemala', /\bguatemala\b/],
  ['Turquia', /\bturk(iye|ey)\b/],
  ['Gana', /\bghana\b/],
  ['África do Sul', /\bsouth africa\b/],
  ['Austrália', /\baustralia\b/],
  ['Suécia', /\bswed(en|ish)\b/],
  ['Suíça', /\bswitzerland\b|\bswiss\b/],
  ['Nova Zelândia', /\bzealand\b/],
  ['Canadá', /\bcanada\b/],
  ['Áustria', /\baustria\b/],
  ['Panamá', /\bpanama\b/],
  ['Haiti', /\bhaiti\b/],
  ['Jamaica', /\bjamaica\b/],
  ['Camarões', /\bcameroon\b/],
  ['Romênia', /\bromania\b/],
  ['Egito', /\begypt(ian)?\b/],
  ['Arábia Saudita', /\bsaudi\b/],
  ['Venezuela', /\bvenezuela(n)?\b/],
  ['Peru', /\bperu\b/],
  ['Polônia', /\bpoland\b|\bpolish\b/],
  ['Paraguai', /\bparaguay\b/],
  ['Grécia', /\bgree(ce|k)\b/],
  ['Congo', /\bcongo\b/],
  ['Marrocos', /\bmorocco\b/],
  ['Hungria', /\bhungary\b/],
  ['Ucrânia', /\bukraine\b/],
  ['Palestina', /\bpalestin(e|ian)?\b/],
  ['União Soviética', /\bsoviet\b|\bussr\b|\bcccp\b/],
  ['Uzbequistão', /\buzbekistan\b/],
  ['Costa do Marfim', /\bcote d'? ?ivoire\b|\bivory coast\b/],
  ['Cabo Verde', /\bcape verde\b|\bcabo verde\b/],
  ['Curaçao', /\bcuracao\b/],
  ['Catar', /\bqatar\b/],
  ['Emirados Árabes', /\buae\b|\bunited arab emirates\b/],
  ['Argélia', /\balgeria\b/],
  ['Islândia', /\biceland\b/],
  ['República Tcheca', /\bczech\b/],
  ['Filipinas', /\bphilippines\b/],
  ['Malásia', /\bmalaysia\b/],
  ['Albânia', /\balbania\b/],
  ['Dinamarca', /\bdenmark\b|\bdanish\b/],
  ['China', /\bchina\b|\bchinese\b/],
  ['Sérvia', /\bserbia\b/],
  ['Rússia', /\brussia\b/],
  ['Bolívia', /\bbolivia\b/],
  ['Costa Rica', /\bcosta rica\b/],
  ['Honduras', /\bhonduras\b/],
  ['Irã', /\biran\b/],
  ['Tunísia', /\btunisia\b/],
  ['Jordânia', /^(?!.*\b(psg|paris|air jordan)\b).*\bjordan\b/],   // "Jordan" também é a marca das camisas do PSG
  ['Iraque', /\biraq\b/],
  ['Israel', /\bisrael\b/],
  ['Finlândia', /\bfinland\b/],
  ['Eslovênia', /\bslovenia\b/],
  ['Eslováquia', /\bslovakia\b/],
  ['Tchecoslováquia', /\bczechoslovakia\b/],
  ['Iugoslávia', /\byugoslavia\b/],
  ['Bulgária', /\bbulgaria\b/],
  ['Bósnia', /\bbosnia\b/],
  ['Guiné Equatorial', /\bequatorial guinea\b/],
  ['El Salvador', /\bel salvador\b/],
  ['País Basco', /\bbasque\b/],
];
// busca: liga da categoria, seleções, depois as outras ligas (Brasil por último)
const ORDEM_LIGAS = [...Object.keys(CLUBES).filter(id => id !== 'brasil'), 'brasil'];
function acharTime(texto, ligaFonte) {
  const ordem = [ligaFonte, 'selecoes', ...ORDEM_LIGAS.filter(id => id !== ligaFonte)];
  for (const liga of ordem) {
    const achou = (liga === 'selecoes' ? SELECOES : CLUBES[liga] || []).find(([, re]) => re.test(texto));
    if (achou) return { time: achou[0], liga };
  }
  return { time: '', liga: ligaFonte };
}
// liga de um time pelo nome (para "ajustes" que mudam só o time)
const LIGA_DO_TIME = new Map([...SELECOES.map(([n]) => [n, 'selecoes']), ...Object.entries(CLUBES).flatMap(([liga, l]) => l.map(([n]) => [n, liga]))]);
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

// "Retro Flamengo 00/01 Home S-XXL" -> { time: "Flamengo", liga: "brasil", detalhe: "2000/01 · Titular", max: "2XL" }
function lerTitulo(titulo, ligaFonte = '') {
  const t = normal(titulo);
  const separado = t.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2');   // "Bahia13/14", "80/81Celtics", "26YW"
  const { time, liga } = acharTime(separado, ligaFonte);
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
  return { time, liga, detalhe, max: tam || '', temporada: temporada(t) };
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

async function lerCategoria(fonte, rotulo = 'a fonte') {
  const base = new URL(fonte);
  const albuns = [];
  for (let pagina = 1, total = 1; pagina <= total; pagina++) {
    const url = new URL(base); url.searchParams.set('page', pagina);
    const html = await pegar(url.href);
    total = +(html.match(/pagination-span">\s*\d+\s*\/\s*(\d+)/) || [])[1] || total;
    const re = /class="album__main"\s+title="([^"]*)"\s+href="\/albums\/(\d+)[^"]*"[\s\S]*?data-src="([^"]+)"[\s\S]*?album__photonumber">(\d+)</g;
    let n = 0;
    for (const m of html.matchAll(re)) { albuns.push({ id: m[2], titulo: decode(m[1]).trim(), capa: m[3], qtd: +m[4] }); n++; }
    process.stdout.write(`\r  lendo ${rotulo}: página ${pagina} de ${total} (${albuns.length} álbuns)`);
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
const ligaPadrao = cfg.ligas[0]?.id || '';   // camisas baixadas antes das ligas vieram da 1ª categoria
let lista;
if (local) {
  lista = [...cache.values()].map(c => ({ id: c.id, titulo: c.titulo, ligaFonte: c.ligaFonte || ligaPadrao, fornecedor: c.fornecedor || 1 }));
  console.log(`Modo local: ${lista.length} camisas já baixadas, sem consultar a fonte.`);
} else if (cfg.ligas.some(l => l.categorias.some(c => c.length))) {
  // uma página de categoria por liga e fornecedor, na ordem do catalogo.json (liga por liga; dentro
  // da liga, o 1º fornecedor e depois o 2º...); cada link da fonte só dá o endereço de uma loja
  const origens = cfg.fontes.map(f => new URL(f).origin);
  lista = [];
  for (const liga of cfg.ligas) for (const [i, cats] of liga.categorias.entries()) for (const categoria of cats) {
    const { albuns } = await lerCategoria(`${origens[i]}/categories/${categoria}`, origens.length > 1 ? `${liga.nome} (fornecedor ${i + 1})` : liga.nome);
    lista.push(...albuns.map(a => ({ ...a, origem: origens[i], fornecedor: i + 1, ligaFonte: liga.id })));
  }
} else {
  lista = [];
  for (const fonte of cfg.fontes) {
    const { origem, albuns } = await lerCategoria(fonte);
    lista.push(...albuns.map(a => ({ ...a, origem, ligaFonte: ligaPadrao })));
  }
}

// 2. classifica, traduz e tira repetidos (mesmo álbum ou mesmo título, mesmo em ligas diferentes) e escondidos
const idsLigas = new Set(cfg.ligas.map(l => l.id));
const vistos = new Set(), fora = [], semTime = [], foraDaLiga = [], repetidas = [];
// a mesma camisa nos dois fornecedores (mesmo modelo, time e detalhe) aparece uma vez só, a do
// fornecedor que vem antes; camisas iguais do mesmo fornecedor ficam (podem ser modelos diferentes)
const doFornecedor = new Map();
const camisas = [];
// classifica primeiro as do 1º fornecedor (para ele ganhar nas repetidas) e depois volta à ordem da lista
lista.forEach((a, i) => { a.ordem = i; });
for (const a of [...lista].sort((x, y) => (x.fornecedor || 1) - (y.fornecedor || 1))) {
  const chave = normal(a.titulo);
  if (vistos.has(chave) || vistos.has(`#${a.id}`)) continue;
  vistos.add(chave); vistos.add(`#${a.id}`);
  const ajuste = cfg.ajustes[a.id] || {};
  const modelo = ajuste.modelo || classificar(a, cfg);
  if (!modelo) { fora.push(a.titulo); continue; }
  if (cfg.esconder.has(a.id)) continue;
  const lido = lerTitulo(a.titulo, a.ligaFonte);
  // álbum sem time e sem temporada no título não é camisa (ex.: "......", capa de seção)
  if (!ajuste.modelo && !lido.time && !lido.temporada) { fora.push(a.titulo); continue; }
  const time = ajuste.time || lido.time;
  // liga: a do ajuste, a do time (pelo nome) ou, se o time é desconhecido, a da categoria.
  // Time de uma liga que não está no catalogo.json (ex.: um PSV na categoria da Bundesliga) vai
  // para "outras", se ela existir; senão a camisa fica de fora.
  const ligaLida = ajuste.liga || (ajuste.time && LIGA_DO_TIME.get(ajuste.time)) || lido.liga || a.ligaFonte;
  const liga = !idsLigas.size ? '' : idsLigas.has(ligaLida) ? ligaLida : idsLigas.has('outras') ? 'outras' : null;
  if (liga === null) { foraDaLiga.push(`${a.titulo}  (${ligaLida})`); continue; }
  const detalhe = ajuste.detalhe ?? (lido.time ? lido.detalhe : a.titulo.replace(/\bS ?[-\u2010-\u2015] ?\S*XL\S*/i, '').trim());
  const fornecedor = a.fornecedor || 1;
  if (time) {
    const igual = `${modelo}|${liga}|${time}|${normal(detalhe)}`;
    const primeiro = doFornecedor.get(igual);
    if (primeiro && primeiro !== fornecedor) { repetidas.push(`${a.id}  ${a.titulo}`); continue; }
    doFornecedor.set(igual, fornecedor);
  }
  if (!time) semTime.push(`${a.id}  ${a.titulo}`);
  camisas.push({ ...a, modelo, liga, fornecedor, time: time || 'Outros', detalhe, max: ajuste.max || lido.max });
}
camisas.sort((x, y) => x.ordem - y.ordem);

const porModelo = id => camisas.filter(c => c.modelo === id).length;
console.log(`Camisas no catálogo: ${camisas.length} (${cfg.modelos.map(m => `${m.nome} ${porModelo(m.id)}`).join(', ')}) · fora do catálogo: ${fora.length}${foraDaLiga.length ? ` · de ligas fora da lista: ${foraDaLiga.length}` : ''}${repetidas.length ? ` · repetidas de outro fornecedor: ${repetidas.length}` : ''}`);
if (cfg.fontes.length > 1) console.log(`Por fornecedor: ${cfg.fontes.map((_, i) => `${i + 1}º ${camisas.filter(c => c.fornecedor === i + 1).length}`).join(', ')}`);

if (simular) {
  const nomeLiga = id => cfg.ligas.find(l => l.id === id)?.nome || '';
  for (const m of cfg.modelos) {
    console.log(`\n== ${m.nome} (R$ ${m.preco.toFixed(2).replace('.', ',')})`);
    for (const c of camisas.filter(c => c.modelo === m.id)) console.log(`  ${c.id} ${cfg.fontes.length > 1 ? `F${c.fornecedor} ` : ''} ${nomeLiga(c.liga).padEnd(15)} ${c.time.padEnd(22)} ${c.detalhe.padEnd(44)} ${c.max.padEnd(4)} ← ${c.titulo}`);
  }
  console.log(`\n== Fora do catálogo (palavras de "excluir")\n  ${fora.join('\n  ')}`);
  if (repetidas.length) console.log(`\n== Já estão no catálogo por outro fornecedor (ficam de fora)\n  ${repetidas.join('\n  ')}`);
  if (semTime.length) console.log(`\n== Sem time reconhecido (aparecem como "Outros"; corrija em "ajustes")\n  ${semTime.join('\n  ')}`);
  if (foraDaLiga.length) console.log(`\n== Times de ligas que não estão em "ligas" (ficam de fora)\n  ${foraDaLiga.join('\n  ')}`);
  if (cfg.ligas.length) {
    console.log('\n== Times por liga');
    for (const l of cfg.ligas) {
      const daLiga = camisas.filter(c => c.liga === l.id);
      const times = new Map();
      daLiga.forEach(c => times.set(c.time, (times.get(c.time) || 0) + 1));
      console.log(`  ${l.nome} (${daLiga.length}): ${[...times].sort((x, y) => y[1] - x[1]).map(([t, q]) => `${t} ${q}`).join(', ')}`);
    }
  }
  process.exit(0);
}

// 3. baixa as fotos das camisas novas
const fotosOk = c => c?.capa && [c.capa, ...(c.fotos || [])].every(f => existsSync(path.join(ROOT, f)));
const limite = +(args.find(a => a.startsWith('--limite=')) || '').split('=')[1] || Infinity;   // para testes
const minutos = +(args.find(a => a.startsWith('--minutos=')) || '').split('=')[1] || Infinity;
const prazo = Date.now() + minutos * 60e3;   // depois disso não começa camisa nova (o resto fica para a próxima vez)
const baixar = local ? [] : camisas.filter(c => tudo || !fotosOk(cache.get(c.id))).slice(0, limite);
let falhas = 0;
if (baixar.length) {
  console.log(`Baixando ${baixar.length} camisa(s) nova(s)...`);
  const browser = await openBrowser();
  let feitas = 0;
  const fila = [...baixar];
  const trabalhador = async () => {
    for (let c; Date.now() < prazo && (c = fila.shift());) {
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
  if (fila.length) console.log(`Tempo esgotado (--minutos=${minutos}): ${fila.length} camisa(s) ficaram para a próxima vez.`);
}

// se "fotosPorCamisa" diminuiu, as camisas já baixadas perdem as fotos que passaram do limite
// (aqui, depois dos downloads, para o catalogo.js nunca apontar para uma foto apagada)
let cortadas = 0;
for (const c of cache.values()) {
  if (!(c.fotos?.length > cfg.fotos)) continue;
  for (const f of c.fotos.slice(cfg.fotos)) { rmSync(path.join(ROOT, f), { force: true }); cortadas++; }
  c.fotos = c.fotos.slice(0, cfg.fotos);
}
if (cortadas) console.log(`Tiradas ${cortadas} foto(s) além de ${cfg.fotos} por camisa ("fotosPorCamisa").`);
// 4. gera js/catalogo.js (na ordem da fonte: liga por liga, as mais recentes primeiro)
const saida = camisas.filter(c => fotosOk(cache.get(c.id))).map(c => {
  const { capa, fotos } = cache.get(c.id);
  const nome = [c.time === 'Outros' ? '' : c.time, c.detalhe.replaceAll(' · ', ' ')].filter(Boolean).join(' ');
  return { id: c.id, modelo: c.modelo, liga: c.liga, ligaFonte: c.ligaFonte, time: c.time, detalhe: c.detalhe, nome, max: c.max, titulo: c.titulo, ...(c.fornecedor > 1 && { fornecedor: c.fornecedor }), capa, fotos };
});
const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const modelos = cfg.modelos.map(({ id, nome, preco }) => ({ id, nome, preco }));
// ligas com camisas, na ordem do catalogo.json (o site mostra o filtro nessa ordem)
const ligas = cfg.ligas.filter(l => saida.some(c => c.liga === l.id)).map(({ id, nome, emblema }) => ({ id, nome, ...(emblema && { emblema }) }));
// camisas fixas nos destaques da home (o site completa com as mais recentes de cada modelo)
const noCatalogo = new Set(saida.map(c => c.id));
const destaques = cfg.destaques.filter(id => noCatalogo.has(id));
const semDestaque = cfg.destaques.filter(id => !noCatalogo.has(id));
if (semDestaque.length) console.log(`Destaques que não estão no catálogo (ignorados): ${semDestaque.join(', ')}`);
writeFileSync(DATA_FILE, `${HEADER}{\n  "atualizado": "${hoje}",\n  "tamanhos": ${JSON.stringify(TAMANHOS)},\n  "modelos": ${JSON.stringify(modelos)},\n  "ligas": ${JSON.stringify(ligas)},\n  "destaques": ${JSON.stringify(destaques)},\n  "camisas": [\n${saida.map(c => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n};\n`);

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
