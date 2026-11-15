// Comprueba servicios externos sin generar, enviar ni publicar contenido.
const timeout = ms => AbortSignal.timeout(ms);
async function jsonRequest(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { ...options, signal: timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + (data.description || data.error_description || data.error?.message || data.error || 'respuesta no válida'));
  return data;
}
async function main(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const keys = ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4'].filter(k => (env[k] || '').trim());
  if (!keys.length) throw new Error('No hay ninguna clave Gemini configurada.');
  console.log('Gemini: hay ' + keys.length + ' secreto(s) configurado(s); no se realizan llamadas a Gemini.');

  const bot = (env.TELEGRAM_BOT_TOKEN || '').trim();
  const chat = (env.TELEGRAM_CHAT_ID || '').trim();
  if (!bot || !chat) throw new Error('Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.');
  const me = await jsonRequest(fetchImpl, 'https://api.telegram.org/bot' + bot + '/getMe');
  if (!me.ok || !me.result?.id) throw new Error('Telegram no ha validado el bot.');
  const destination = await jsonRequest(fetchImpl, 'https://api.telegram.org/bot' + bot + '/getChat?chat_id=' + encodeURIComponent(chat));
  if (!destination.ok || !destination.result?.id) throw new Error('Telegram no ha validado el chat de destino.');
  console.log('Telegram: bot y destino verificados; no se ha enviado ningún mensaje ni vídeo.');

  const yt = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'].map(k => (env[k] || '').trim());
  if (yt.every(Boolean)) {
    const token = await jsonRequest(fetchImpl, 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: yt[0], client_secret: yt[1], refresh_token: yt[2], grant_type: 'refresh_token' })
    });
    if (!token.access_token) throw new Error('Google no devolvió un access token de YouTube.');
    console.log('YouTube: OAuth validado; no se ha subido ningún vídeo.');
  } else if (yt.every(v => !v)) {
    console.log('YouTube: no conectado; se omitirá la publicación.');
  } else {
    throw new Error('La configuración OAuth de YouTube está incompleta: deben existir los tres secretos o ninguno.');
  }
}
if (require.main === module) {
  main().catch(error => { console.error('Preflight fallido:', error.message || error); process.exit(1); });
}
module.exports = { main };
