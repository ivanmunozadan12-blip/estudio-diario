// Ejecuta la web real en Chromium, genera uno o tres vídeos y guarda los archivos.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const requested = process.argv[2], day = process.argv[3];
const batch = requested === 'all' || process.env.BATCH_ALL === 'true';
const slot = batch ? 0 : +requested;
if (!batch && (!Number.isInteger(slot) || slot < 0 || slot > 2)) throw new Error('El slot debe ser 0, 1 o 2.');
if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day || '')) throw new Error('La fecha de generación no es válida.');
if (!fs.existsSync('site/index.html')) throw new Error('No existe site/index.html; no se iniciará Chromium.');
const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const hist = JSON.parse(fs.readFileSync('history.json', 'utf8'));
const keys = [...new Set([process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_4].map(v => (v || '').trim()).filter(Boolean))];
if (!keys.length) { console.error('Falta el secreto GEMINI_API_KEY'); process.exit(2); }
console.log('Claves Gemini configuradas:', keys.length, '(los valores nunca se muestran).');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => {
  const requestedPath = decodeURIComponent((q.url || '/').split('?')[0]);
  if (process.env.CI_MOCK && requestedPath === '/.netlify/functions/history-sync') {
    r.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); r.end(JSON.stringify({ ok: true, duplicate: false })); return;
  }
  const f = path.join('site', requestedPath === '/' ? 'index.html' : requestedPath);
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } });
}).listen(8099);
const toB64 = async blob => {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
  return btoa(bin);
};
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  if (process.env.CI_MOCK) await require(path.resolve(process.env.CI_MOCK))(page);
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.error('[pageerror]', e.message); });
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });
  page.on('response', r => {
    if (r.status() >= 400) console.log('[HTTP ' + r.status() + ' ' + r.request().method() + ']', r.url());
  });
  page.on('requestfailed', r => { if (!r.url().startsWith('blob:')) console.log('[request failed]', r.method(), r.url(), r.failure()?.errorText || ''); });
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options = {}) => {
      // Evita que un único endpoint de Gemini bloquee toda la rotación.
      const isGemini = typeof url === 'string' && url.includes('generativelanguage.googleapis.com');
      const timeout = AbortSignal.timeout(isGemini ? 30000 : 60000);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      return originalFetch(url, { ...options, signal });
    };
  });
  await page.addInitScript(({ keys, cfg, topics }) => {
    const set = (k, v) => localStorage.setItem('set:' + k, JSON.stringify(v));
    set('provider', 'gemini');
    set('apiKey', keys[0]);
    set('extraApiKeys', keys.slice(1).join('\n'));
    set('niche', cfg.nicho);
    set('target', String(cfg.duracion));
    set('voiceEngine', 'natural');
    set('voiceId', cfg.voiceId || 'es_ES-davefx-medium');
    set('research', !!cfg.investigar);
    set('verify', !!cfg.verificar);
    if (cfg.forceTopics && cfg.forceTopics.length === 3) {
      set('slots', cfg.forceTopics.map(topic => ({ topic, own: '', script: null })));
    }

    localStorage.setItem('hist', JSON.stringify(topics));
  }, { keys, cfg, topics: hist.slice(-40).map(h => h.tema).filter(Boolean) });
  await page.goto('http://localhost:8099/index.html');
  await page.waitForFunction(() => window.__studio && window.__studio.Voice, null, { timeout: 30000 });
  if (pageErrors.length) throw new Error('La web ha producido errores antes de generar: ' + pageErrors.join(' | '));

  // La voz neuronal se utiliza directamente durante la generación; no se ejecuta una prueba previa.

  const saveMeta = async (i, item, index) => {
    const mime = String(item.ext || 'mp4').toLowerCase();
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const rawName = batch ? `out/raw-${index + 1}.${ext}` : `out/raw.${ext}`;
    const captionName = batch ? `out/caption-${index + 1}.txt` : 'out/caption.txt';
    const videoBuffer = Buffer.from(item.b64, 'base64');
    if (!videoBuffer.length) throw new Error('El vídeo generado llegó vacío; no se guardará ni se enviará.');
    fs.writeFileSync(rawName, videoBuffer);
    if (!fs.existsSync(rawName) || fs.statSync(rawName).size !== videoBuffer.length) throw new Error('No se pudo verificar el archivo de vídeo guardado: ' + rawName);
    console.log(`Archivo fuente verificado: ${rawName} (${videoBuffer.length} bytes)`);
    const m = item.meta;
    const tags = (m.hashtags || []).map(h => '#' + h).join(' ');
    fs.writeFileSync(captionName, `${m.titulo}\n\n${m.descripcion}\n\n${tags} #Shorts\n\nFuentes: ${(m.fuentes || []).map(f => f.url || f).join(' · ') || 'n/d'}`);
    hist.push({ dia: day, slot: i, tema: m.tema, titulo: m.titulo });
    console.log(`Vídeo ${i + 1} guardado: ${m.titulo} | ${item.voice}`);
  };

  if (batch) {
    console.log('Modo lote: la propia web elegirá tres temas distintos y generará los tres vídeos.');
    await page.click('#allBtn');
    await page.waitForFunction(() => document.querySelector('#allBtn')?.disabled === true, null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('#allBtn')?.disabled === false, null, { timeout: 1800000 });
    const result = await page.evaluate(async () => {
      const slots = window.__studio.slots;
      return Promise.all(slots.map(async (s, i) => ({
        i,
        ready: !!(s.blob && s.url && s.script),
        topic: s.topic,
        meta: s.script ? { tema: s.topic, titulo: s.script.titulo, descripcion: s.script.descripcion, hashtags: s.script.hashtags, fuentes: s.script.fuentes || [] } : null,
        ext: s.ext,
        b64: s.blob ? await (async blob => { const b = new Uint8Array(await blob.arrayBuffer()); let x = ''; for (let k = 0; k < b.length; k += 0x8000) x += String.fromCharCode.apply(null, b.subarray(k, k + 0x8000)); return btoa(x); })(s.blob) : '',
        error: s.err || ''
      })));
    });
    if (result.length !== 3 || result.some(x => !x.ready)) {
      const status = await page.locator('#msg').textContent().catch(() => '');
      throw new Error('La web no completó los tres vídeos. Estado: ' + status + '. Detalle: ' + JSON.stringify(result.map(x => ({ i: x.i, topic: x.topic, error: x.error, ready: x.ready }))));
    }
    const topics = result.map(x => x.topic.trim().toLowerCase());
    if (new Set(topics).size !== 3) throw new Error('La web no ha propuesto tres temas diferentes: ' + JSON.stringify(result.map(x => x.topic)));
    for (const item of result) await saveMeta(item.i, item, item.i);
  } else {
    const generation = await page.evaluate(async i => {
      try {
        await Promise.race([
          window.__studio.genScript(i, window.__studio.settings()),
          new Promise((_, reject) => setTimeout(() => reject(new Error('La generación superó el límite de 12 minutos.')), 720000))
        ]);
        return { ok: true, title: window.__studio.slots[i].script?.titulo || '' };
      } catch (e) { return { ok: false, error: e?.message || String(e), code: e?.code || '' }; }
    }, slot);
    if (!generation.ok) throw new Error('Gemini no pudo generar el guion: ' + generation.error);
    const meta = await page.evaluate(i => { const s = window.__studio.slots[i]; return { tema: s.topic, titulo: s.script.titulo, descripcion: s.script.descripcion, hashtags: s.script.hashtags, fuentes: s.script.fuentes || [] }; }, slot);
    await page.evaluate(i => { const b = document.querySelector(`button[data-a="rec"][data-i="${i}"]`); if (b) b.disabled = false; }, slot);
    await page.click(`button[data-a=rec][data-i="${slot}"]`);
    await page.waitForSelector(`#slot${slot} video.out`, { timeout: 900000 });
    const voiceLabel = process.env.CI_MOCK ? 'Voz sintética de prueba' : 'Piper neuronal';
    const item = await page.evaluate(async ({ i, voice }) => {
      const s = window.__studio.slots[i];
      const buf = new Uint8Array(await s.blob.arrayBuffer()); let bin = '';
      for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
      return { ext: s.ext, b64: btoa(bin), meta: { tema: s.topic, titulo: s.script.titulo, descripcion: s.script.descripcion, hashtags: s.script.hashtags, fuentes: s.script.fuentes || [] }, voice };
    }, { i: slot, voice: voiceLabel });
    await saveMeta(slot, item, 0);
  }
  if (pageErrors.length) throw new Error('La página produjo errores JavaScript: ' + pageErrors.join(' | '));
  fs.writeFileSync('history.json', JSON.stringify(hist.slice(-200), null, 1));
  await browser.close();
  srv.close();
})().catch(e => { console.error(e); try { srv.close(); } catch (_) {} process.exit(1); });
