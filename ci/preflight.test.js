// Simula Telegram y OAuth de Google para verificar que el preflight nunca publica.
const assert = require('node:assert/strict');
const { main } = require('./preflight');

(async () => {
  const calls = [];
  const env = {
    GEMINI_API_KEY: 'dummy-gemini-key',
    TELEGRAM_BOT_TOKEN: 'dummy-telegram-token',
    TELEGRAM_CHAT_ID: '-1001234567890',
    YOUTUBE_CLIENT_ID: 'dummy-client',
    YOUTUBE_CLIENT_SECRET: 'dummy-secret',
    YOUTUBE_REFRESH_TOKEN: 'dummy-refresh'
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/getMe')) return new Response(JSON.stringify({ ok: true, result: { id: 123 } }), { status: 200 });
    if (String(url).includes('/getChat?')) return new Response(JSON.stringify({ ok: true, result: { id: -1001234567890, type: 'supergroup' } }), { status: 200 });
    if (String(url).includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'dummy-access-token' }), { status: 200 });
    throw new Error('Petición externa no permitida en el test: ' + url);
  };
  await main({ env, fetchImpl });
  assert.equal(calls.length, 3);
  assert(calls.some(c => c.url.endsWith('/getMe')));
  assert(calls.some(c => c.url.includes('/getChat?')));
  assert(calls.some(c => c.url.includes('oauth2.googleapis.com/token')));
  assert(calls.every(c => !c.url.includes('sendVideo') && !c.url.includes('sendMessage') && !c.url.includes('generativelanguage.googleapis.com')));

  await assert.rejects(() => main({ env: { GEMINI_API_KEY: 'dummy' }, fetchImpl }), /Faltan TELEGRAM_BOT_TOKEN/);
  await assert.rejects(() => main({ env: { ...env, YOUTUBE_REFRESH_TOKEN: '' }, fetchImpl }), /configuración OAuth de YouTube está incompleta/);
  console.log('Preflight tests OK: Telegram y OAuth simulados; sin llamadas a Gemini, sin envíos ni publicaciones.');
})().catch(error => { console.error(error); process.exit(1); });
