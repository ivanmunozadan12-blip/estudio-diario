// Pruebas unitarias de seguridad de funciones Netlify. No hacen peticiones externas.
const assert = require('node:assert/strict');
const history = require('../netlify/functions/history-sync').handler;
const youtubeAuth = require('../netlify/functions/youtube-auth').handler;
const youtubeCallback = require('../netlify/functions/youtube-callback').handler;

const origin = 'https://glistening-cascaron-b5b987.netlify.app';
const headers = { origin, host: 'glistening-cascaron-b5b987.netlify.app', 'content-type': 'application/json' };
const validBody = JSON.stringify({ tema: 'Tema de prueba suficientemente largo', titulo: 'Prueba', slot: 0 });
async function run() {
  delete process.env.GITHUB_HISTORY_TOKEN;
  process.env.SITE_ORIGIN = origin;
  assert.equal((await history({ httpMethod: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: validBody })).statusCode, 403);
  assert.equal((await history({ httpMethod: 'GET', headers, body: '' })).statusCode, 405);
  assert.equal((await history({ httpMethod: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: validBody })).statusCode, 415);
  assert.equal((await history({ httpMethod: 'POST', headers, body: 'x'.repeat(4097) })).statusCode, 413);
  assert.equal((await history({ httpMethod: 'POST', headers, body: validBody })).statusCode, 503);

  process.env.GITHUB_HISTORY_TOKEN = 'test-token-not-used';
  assert.equal((await history({ httpMethod: 'POST', headers, body: '{' })).statusCode, 400);
  assert.equal((await history({ httpMethod: 'POST', headers, body: JSON.stringify({ tema: 'Tema de prueba suficientemente largo', titulo: 'Prueba', slot: 9 }) })).statusCode, 400);
  let existingHistory = [];
  let historyFetches = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    historyFetches++;
    if (options.method === 'PUT') {
      const payload = JSON.parse(options.body);
      existingHistory = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8'));
      return new Response(JSON.stringify({ content: { sha: 'updated' } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      sha: 'current',
      content: Buffer.from(JSON.stringify(existingHistory), 'utf8').toString('base64')
    }), { status: 200 });
  };
  try {
    const saved = await history({ httpMethod: 'POST', headers, body: validBody });
    assert.equal(saved.statusCode, 200);
    assert.equal(JSON.parse(saved.body).duplicate, false);
    assert.equal(existingHistory.length, 1);
    assert.equal(existingHistory[0].slot, 0);
    assert.equal(historyFetches, 2);
    existingHistory[0].tema = 'Téma de prueba suficientemente largo';
    historyFetches = 0;
    const duplicate = await history({ httpMethod: 'POST', headers, body: validBody });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(JSON.parse(duplicate.body).duplicate, true);
    assert.equal(historyFetches, 1);
  } finally {
    global.fetch = originalFetch;
    delete process.env.GITHUB_HISTORY_TOKEN;
  }

  delete process.env.YOUTUBE_CLIENT_ID;
  delete process.env.YOUTUBE_CLIENT_SECRET;
  assert.equal((await youtubeAuth({ rawUrl: origin + '/.netlify/functions/youtube-auth' })).statusCode, 500);
  assert.equal((await youtubeCallback({ headers: {}, queryStringParameters: { state: 'invalid' }, rawUrl: origin + '/.netlify/functions/youtube-callback' })).statusCode, 400);
  console.log('Security tests OK: origen, método, tipo de contenido, tamaño, token ausente, JSON/slot inválidos, sincronización/duplicados y OAuth inválido.');
}
run().catch(error => { console.error(error); process.exit(1); });
