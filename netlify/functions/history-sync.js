const REPO = 'ivanmunozadan12-blip/estudio-diario';
const BRANCH = 'main';
const DEFAULT_ORIGIN = 'https://glistening-cascaron-b5b987.netlify.app';
const API = `https://api.github.com/repos/${REPO}/contents/history.json`;

const response = (statusCode, body, origin) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {})
  },
  body: JSON.stringify(body)
});

const normalize = value => String(value || '')
  .normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

exports.handler = async event => {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const host = event.headers?.host || event.headers?.Host || '';
  const allowedOrigin = process.env.SITE_ORIGIN || DEFAULT_ORIGIN;
  let originHost = '';
  try { originHost = new URL(origin).host; } catch (_) {}
  if (origin !== allowedOrigin || originHost !== host) return response(403, { ok: false, error: 'Origen no permitido.' });
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Método no permitido.' }, origin);
  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';
  if ((contentType.split(';', 1)[0] || '').trim().toLowerCase() !== 'application/json') return response(415, { ok: false, error: 'Se requiere Content-Type application/json.' }, origin);
  if (Buffer.byteLength(event.body || '', 'utf8') > 4096) return response(413, { ok: false, error: 'Solicitud demasiado grande.' }, origin);

  const token = process.env.GITHUB_HISTORY_TOKEN;
  if (!token) return response(503, { ok: false, error: 'Falta configurar GITHUB_HISTORY_TOKEN en Netlify.' }, origin);

  let input;
  try { input = JSON.parse(event.body || '{}'); } catch (_) {
    return response(400, { ok: false, error: 'Solicitud JSON no válida.' }, origin);
  }
  const tema = String(input.tema || '').trim().slice(0, 300);
  const titulo = String(input.titulo || '').trim().slice(0, 160);
  if (tema.length < 8) return response(400, { ok: false, error: 'El tema es demasiado corto.' }, origin);
  if (!Number.isInteger(input.slot) || input.slot < 0 || input.slot > 2) return response(400, { ok: false, error: 'El slot debe ser 0, 1 o 2.' }, origin);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'estudio-diario-history-sync'
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const current = await fetch(`${API}?ref=${BRANCH}`, { headers });
      if (!current.ok) throw new Error(`GitHub no pudo leer history.json (HTTP ${current.status}).`);
      const file = await current.json();
      const decoded = Buffer.from(file.content || '', 'base64').toString('utf8');
      const history = JSON.parse(decoded);
      const key = normalize(tema);
      if (history.some(item => normalize(item.tema) === key)) {
        return response(200, { ok: true, duplicate: true }, origin);
      }

      history.push({
        dia: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }),
        slot: input.slot,
        tema,
        titulo: titulo || tema,
        ...(input.firma && typeof input.firma === 'object' ? { firma: ['p', 'e', 'c', 'm'].reduce((o, k) => (Number.isInteger(input.firma[k]) ? { ...o, [k]: input.firma[k] } : o), {}) } : {}),
        origen: 'web'
      });
      const updated = await fetch(API, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Registrar tema generado desde la web',
          content: Buffer.from(JSON.stringify(history.slice(-200), null, 1), 'utf8').toString('base64'),
          sha: file.sha,
          branch: BRANCH
        })
      });
      if (updated.ok) return response(200, { ok: true, duplicate: false }, origin);
      if (updated.status === 409 || updated.status === 422) continue;
      throw new Error(`GitHub no pudo guardar el tema (HTTP ${updated.status}).`);
    } catch (error) {
      if (attempt === 2) return response(502, { ok: false, error: error.message || 'No se pudo sincronizar el historial.' }, origin);
    }
  }
  return response(409, { ok: false, error: 'Conflicto al actualizar el historial; inténtalo de nuevo.' }, origin);
};
