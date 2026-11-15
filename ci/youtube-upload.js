// Publica vídeos MP4 en YouTube mediante sesiones reanudables y bloques de 8 MiB.
const fs = require('node:fs');
const path = require('node:path');
const CHUNK_SIZE = 8 * 1024 * 1024;

async function main(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const cwd = options.cwd || process.cwd();
  const clientId = env.YOUTUBE_CLIENT_ID;
  const clientSecret = env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = env.YOUTUBE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    console.log('YouTube no está conectado todavía: se omite la publicación.');
    return [];
  }

  const tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' })
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error('No se pudo renovar la autorización de YouTube: ' + (tokenData.error_description || tokenData.error || tokenResponse.status));
  }

  const outDir = path.join(cwd, 'out');
  const files = fs.readdirSync(outDir).filter(f => /^video(?:-\d+)?\.mp4$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) throw new Error('No hay vídeos MP4 para subir a YouTube.');
  const uploaded = [];

  for (const file of files) {
    const captionFile = file.replace(/^video/, 'caption').replace(/\.mp4$/, '.txt');
    const captionPath = path.join(outDir, captionFile);
    const caption = fs.existsSync(captionPath) ? fs.readFileSync(captionPath, 'utf8') : '';
    const lines = caption.split(/\r?\n/);
    const title = (lines.shift() || path.basename(file, '.mp4')).trim().slice(0, 100);
    const description = lines.join('\n').trim().slice(0, 4900);
    const tags = [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || [])
      .map(x => x.slice(1).replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean))].slice(0, 15);
    const metadata = {
      snippet: { title, description, tags, categoryId: '27', defaultLanguage: 'es' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }
    };
    const video = fs.readFileSync(path.join(outDir, file));
    if (!video.length) throw new Error('El vídeo está vacío: ' + file);

    const session = await fetchImpl('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tokenData.access_token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(video.length)
      },
      body: JSON.stringify(metadata)
    });
    if (!session.ok) {
      const error = await session.json().catch(() => ({}));
      throw new Error('YouTube no pudo iniciar la subida de ' + file + ': ' + (error.error?.message || session.status));
    }
    const sessionUrl = session.headers.get('location');
    if (!sessionUrl) throw new Error('YouTube no devolvió la URL de la sesión reanudable para ' + file + '.');

    let offset = 0;
    let result = null;
    while (offset < video.length) {
      const end = Math.min(offset + CHUNK_SIZE, video.length) - 1;
      let upload;
      try {
        upload = await fetchImpl(sessionUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': String(end - offset + 1),
            'Content-Range': 'bytes ' + offset + '-' + end + '/' + video.length
          },
          body: video.subarray(offset, end + 1)
        });
      } catch (error) {
        throw new Error('Se interrumpió la subida reanudable de ' + file + '. No repitas esta ejecución sin comprobar primero el estado en YouTube. Detalle: ' + (error.message || error));
      }

      if (upload.status === 308) {
        const range = upload.headers.get('range') || '';
        const accepted = /bytes=0-(\d+)/i.exec(range);
        const nextOffset = accepted ? Number(accepted[1]) + 1 : offset;
        if (nextOffset <= offset || nextOffset > video.length) {
          throw new Error('YouTube no confirmó el bloque subido de ' + file + '.');
        }
        offset = nextOffset;
        continue;
      }
      const data = await upload.json().catch(() => ({}));
      if (!upload.ok) throw new Error('YouTube rechazó ' + file + ': ' + (data.error?.message || upload.status));
      if (!data.id) throw new Error('YouTube no devolvió el ID del vídeo publicado: ' + file);
      result = data;
      offset = video.length;
    }

    uploaded.push({ file, id: result.id, title });
    console.log('Publicado en YouTube:', title, '| ID:', result.id, '| visibilidad: pública');
  }
  return uploaded;
}

if (require.main === module) {
  main().catch(error => { console.error(error.message || error); process.exit(1); });
}
module.exports = { main, CHUNK_SIZE };
