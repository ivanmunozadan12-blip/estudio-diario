// Sube los vídeos MP4 de esta ejecución a YouTube Shorts usando OAuth offline.
const fs = require('node:fs');
const path = require('node:path');

const { YOUTUBE_CLIENT_ID: clientId, YOUTUBE_CLIENT_SECRET: clientSecret, YOUTUBE_REFRESH_TOKEN: refreshToken } = process.env;
if (!clientId || !clientSecret || !refreshToken) {
  console.log('YouTube no está conectado todavía: se omite la publicación.');
  process.exit(0);
}

async function main() {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' })
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) throw new Error('No se pudo renovar la autorización de YouTube: ' + (tokenData.error_description || tokenData.error || tokenResponse.status));
  const accessToken = tokenData.access_token;
  const files = fs.readdirSync('out').filter(f => /^video(?:-\d+)?\.mp4$/.test(f)).sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) throw new Error('No hay vídeos MP4 para subir a YouTube.');
  for (const file of files) {
    const captionFile = file.replace(/^video/, 'caption').replace(/\.mp4$/, '.txt');
    const caption = fs.existsSync(path.join('out', captionFile)) ? fs.readFileSync(path.join('out', captionFile), 'utf8') : '';
    const lines = caption.split(/\r?\n/);
    const title = (lines.shift() || path.basename(file, '.mp4')).trim().slice(0, 100);
    const description = lines.join('\n').trim().slice(0, 4900);
    const tags = [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map(x => x.slice(1).replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean))].slice(0, 15);
    const metadata = { snippet: { title, description, tags, categoryId: '27', defaultLanguage: 'es' }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } };
    const boundary = '----estudiodiario' + require('node:crypto').randomBytes(12).toString('hex');
    const video = fs.readFileSync(path.join('out', file));
    const body = Buffer.concat([
      Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n'),
      Buffer.from('--' + boundary + '\r\nContent-Type: video/mp4\r\n\r\n'),
      video,
      Buffer.from('\r\n--' + boundary + '--')
    ]);
    const upload = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'multipart/related; boundary=' + boundary, 'Content-Length': String(body.length) },
      body
    });
    const result = await upload.json();
    if (!upload.ok) throw new Error('YouTube rechazó ' + file + ': ' + (result.error?.message || upload.status));
    console.log('Publicado en YouTube:', title, '| ID:', result.id, '| visibilidad: pública');
  }
}
main().catch(error => { console.error(error.message || error); process.exit(1); });
