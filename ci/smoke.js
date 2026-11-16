// Prueba de arranque visual en Chromium sin llamar a Gemini ni a servicios externos.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = process.cwd();
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) {
    res.writeHead(403); return res.end();
  }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

(async () => {
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(8099, '127.0.0.1', resolve);
    });
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    await page.addInitScript(() => { try { localStorage.setItem('simple', 'false'); } catch (e) {} });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' && url.port === '8099') return route.continue();
      return route.abort();
    });
    await page.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#slot0 .top', { timeout: 15000 });
    const result = await page.evaluate(() => ({
      title: document.title,
      slots: [0, 1, 2].filter(i => document.querySelector('#slot' + i + ' .top')).length,
      generateButton: !!document.querySelector('#allBtn'),
      counter: document.querySelector('#counter')?.textContent || '',
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth
    }));
    if (!result.title || result.slots !== 3 || !result.generateButton || !result.counter) {
      throw new Error('La interfaz no ha terminado de arrancar: ' + JSON.stringify(result));
    }
    if (errors.length) throw new Error('Errores JavaScript durante el arranque: ' + errors.join(' | '));
    console.log('Smoke test OK:', JSON.stringify(result), 'Sin llamadas externas ni generación.');
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exit(1); });
