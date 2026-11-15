// Abre la web en un Chromium sin pantalla, genera el vídeo y lo guarda en out/video.webm
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const slot = +process.argv[2], day = process.argv[3]; const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8')); const hist = JSON.parse(fs.readFileSync('history.json', 'utf8'));
const key = process.env.GEMINI_API_KEY; if (!key) { console.error('Falta el secreto GEMINI_API_KEY'); process.exit(2); }
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let f = path.join('site', q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(8099);
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' }); const p = await ctx.newPage();
  if (process.env.CI_MOCK) await require(path.resolve(process.env.CI_MOCK))(p);
  p.on('pageerror', e => console.log('[pageerror]', e.message));
  p.on('console', m => console.log('[browser ' + m.type() + ']', m.text()));
  p.on('console', m => { if (m.type() === 'error') console.log('[browser console]', m.text()); });
  p.on('requestfailed', r => { if (/googleapis|wikipedia/i.test(r.url())) console.log('[request failed]', r.url(), r.failure()?.errorText || ''); });
  p.on('response', r => { if (/generativelanguage.googleapis.com/.test(r.url()) && r.status() >= 400) console.log('[Gemini HTTP]', r.status(), r.url()); });
  await p.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options = {}) => {
      const timeout = AbortSignal.timeout(90000);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      return originalFetch(url, { ...options, signal });
    };
  });
  await p.addInitScript(({ key, cfg, topics }) => {
    const set = (k, v) => localStorage.setItem('set:' + k, JSON.stringify(v));
    set('provider', 'gemini'); set('apiKey', key); set('niche', cfg.nicho); set('target', String(cfg.duracion)); set('voiceEngine', cfg.voz); set('research', !!cfg.investigar); set('verify', !!cfg.verificar);
    localStorage.setItem('hist', JSON.stringify(topics));
  }, { key, cfg, topics: hist.slice(-40).map(h => h.tema).filter(Boolean) });
  await p.goto('http://localhost:8099/index.html'); await p.waitForTimeout(800);
  const generation = await p.evaluate(async i => {
    try {
      const result = await Promise.race([
        window.__studio.genScript(i, window.__studio.settings()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('La generación superó el límite de 6 minutos.')), 360000))
      ]);
      return { ok: true, title: window.__studio.slots[i].script?.titulo || '', topic: window.__studio.slots[i].topic || '' };
    } catch (e) {
      return { ok: false, error: e?.message || String(e), code: e?.code || '' };
    }
  }, slot);
  if (!generation.ok) throw new Error('Gemini no pudo generar el guion' + (generation.code ? ' [' + generation.code + ']' : '') + ': ' + generation.error);
  console.log('Guion listo:', generation.title);
  const meta = await p.evaluate(i => { const s = window.__studio.slots[i]; return { tema: s.topic, titulo: s.script.titulo, descripcion: s.script.descripcion, hashtags: s.script.hashtags, fuentes: s.script.fuentes || [] }; }, slot);
  console.log('Guion listo:', meta.titulo);
  await p.evaluate(i => { const b = document.querySelector(`button[data-a="rec"][data-i="${i}"]`); if (b) b.disabled = false; }, slot);
  await p.click(`button[data-a=rec][data-i="${slot}"]`);
  await p.waitForSelector(`#slot${slot} video.out`, { timeout: 900000 });
  const info = await p.evaluate(async i => { const s = window.__studio.slots[i]; const buf = new Uint8Array(await s.blob.arrayBuffer()); let bin = ''; for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000)); return { ext: s.ext, b64: btoa(bin), voz: document.querySelector('#msg').textContent }; }, slot);
  fs.writeFileSync('out/raw.' + info.ext, Buffer.from(info.b64, 'base64'));
  const tags = (meta.hashtags || []).map(h => '#' + h).join(' ');
  fs.writeFileSync('out/caption.txt', `${meta.titulo}\n\n${meta.descripcion}\n\n${tags} #Shorts\n\nFuentes: ${(meta.fuentes || []).map(f => f.url || f).join(' · ') || 'n/d'}`);
  hist.push({ dia: day, slot, tema: meta.tema, titulo: meta.titulo }); fs.writeFileSync('history.json', JSON.stringify(hist.slice(-200), null, 1));
  console.log('Vídeo grabado', info.ext, info.voz); await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
