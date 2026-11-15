// Simula el protocolo YouTube resumable en memoria; no conecta con Google.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main, CHUNK_SIZE } = require('./youtube-upload');

(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-youtube-test-'));
  try {
    const out = path.join(cwd, 'out');
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'video.mp4'), Buffer.alloc(CHUNK_SIZE + 10, 7));
    fs.writeFileSync(path.join(out, 'caption.txt'), 'Título de prueba\n\nDescripción\n\n#prueba #shorts');
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'mock-access-token' }), { status: 200 });
      }
      if (String(url).includes('uploadType=resumable')) {
        const metadata = JSON.parse(options.body);
        assert.equal(metadata.status.privacyStatus, 'public');
        assert.equal(options.headers['X-Upload-Content-Length'], String(CHUNK_SIZE + 10));
        return new Response(null, { status: 200, headers: { Location: 'https://upload.invalid/session' } });
      }
      assert.equal(String(url), 'https://upload.invalid/session');
      assert.equal(options.method, 'PUT');
      if (calls.filter(c => c.url === String(url)).length === 1) {
        assert.equal(options.headers['Content-Range'], 'bytes 0-' + (CHUNK_SIZE - 1) + '/' + (CHUNK_SIZE + 10));
        return new Response(null, { status: 308, headers: { Range: 'bytes=0-' + (CHUNK_SIZE - 1) } });
      }
      assert.equal(options.headers['Content-Range'], 'bytes ' + CHUNK_SIZE + '-' + (CHUNK_SIZE + 9) + '/' + (CHUNK_SIZE + 10));
      return new Response(JSON.stringify({ id: 'mock-video-id' }), { status: 201 });
    };
    const uploaded = await main({
      cwd,
      fetchImpl,
      env: { YOUTUBE_CLIENT_ID: 'mock-id', YOUTUBE_CLIENT_SECRET: 'mock-secret', YOUTUBE_REFRESH_TOKEN: 'mock-refresh' }
    });
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].id, 'mock-video-id');
    assert.equal(calls.filter(c => c.options.method === 'PUT').length, 2);
    assert.equal((await main({ cwd, fetchImpl, env: {} })).length, 0);
    console.log('YouTube resumable tests OK: OAuth simulado, metadatos públicos, dos bloques, reanudación 308 y modo desconectado.');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
