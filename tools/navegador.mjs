/*
  Navegador headless (Edge ou Chrome) usado pelas ferramentas do site.
    - tools/instagram.mjs: lê o embed dos posts do Instagram (modo manual).
    - tools/catalogo.mjs: converte as fotos do catálogo para WebP (o canvas do navegador
      faz o redimensionamento e a compressão, sem instalar nenhuma biblioteca).
*/
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function findBrowser() {
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

export async function openBrowser() {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = path.join(tmpdir(), `vs-ig-${port}`);
  mkdirSync(profile, { recursive: true });
  const flags = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=600,1300'];
  if (process.env.CI) flags.push('--no-sandbox');   // GitHub Actions (Ubuntu 24.04 não libera a sandbox do Chrome)
  const proc = spawn(findBrowser(), flags, { stdio: 'ignore' });
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
  // a aba inicial ainda pode trocar de página logo depois de abrir; fixa numa página em branco
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(500);
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.error) throw new Error(r.error.message);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'erro no navegador');
    return r.result?.result?.value;
  };
  return {
    send,
    evaluate,
    // redimensiona (lado maior = max px) e comprime em WebP; devolve um Buffer
    async toWebp(buffer, max, quality = .74) {
      const b64 = await evaluate(`(async () => {
        const bin = Uint8Array.from(atob(${JSON.stringify(Buffer.from(buffer).toString('base64'))}), c => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bin]));
        const k = Math.min(1, ${max} / Math.max(bmp.width, bmp.height));
        const canvas = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        const out = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/webp', quality: ${quality} })).arrayBuffer());
        let s = '';
        for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
        return btoa(s);
      })()`);
      return Buffer.from(b64, 'base64');
    },
    close() { try { ws.close(); } catch {} proc.kill(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 800); },
  };
}
