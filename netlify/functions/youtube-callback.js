const crypto = require('node:crypto');

const page = (title, message, token = '') => {
  const safe = String(token).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
  <style>body{font:16px system-ui;background:#101713;color:#f2f5f2;max-width:620px;margin:40px auto;padding:20px}main{background:#1b2520;border:1px solid #344239;border-radius:16px;padding:22px}textarea{box-sizing:border-box;width:100%;min-height:110px;background:#0c110e;color:#fff;border:1px solid #536458;border-radius:8px;padding:10px;overflow-wrap:anywhere}button,a{display:inline-block;background:#ffc533;color:#201800;border:0;border-radius:9px;padding:12px 16px;font-weight:700;text-decoration:none;margin:8px 6px 8px 0}small{color:#b5c2b9}code{overflow-wrap:anywhere}</style>
  <main><h1>${title}</h1><p>${message}</p>${token ? `<label for="token">Token de actualización (secreto):</label><textarea id="token" readonly>${safe}</textarea><button id="copy">Copiar token</button><p><a href="https://github.com/ivanmunozadan12-blip/estudio-diario/settings/secrets/actions" target="_blank" rel="noreferrer">Abrir secretos de GitHub</a></p><ol><li>Pulsa «New repository secret».</li><li>Nombre: <code>YOUTUBE_REFRESH_TOKEN</code>.</li><li>Pega el token y guarda.</li><li>Comprueba también que existen los secretos <code>YOUTUBE_CLIENT_ID</code> y <code>YOUTUBE_CLIENT_SECRET</code>, con los valores del cliente OAuth de tipo Aplicación web de Google.</li></ol><small>Este token permite publicar en tu canal. No lo compartas ni lo envíes por chat. Cierra esta página después de guardarlo.</small><script>document.getElementById('copy').addEventListener('click',async()=>{const t=document.getElementById('token');try{await navigator.clipboard.writeText(t.value);document.getElementById('copy').textContent='Copiado';}catch(e){t.focus();t.select();document.execCommand('copy');document.getElementById('copy').textContent='Copiado';}});</script>` : ''}</main></html>`;
};

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
  const cookies = Object.fromEntries((event.headers.cookie || event.headers.Cookie || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(x => x.length === 2));
  const suppliedState = event.queryStringParameters?.state || '';
  const savedState = cookies.yt_oauth_state || '';
  if (!suppliedState || !savedState || suppliedState.length !== savedState.length || !crypto.timingSafeEqual(Buffer.from(suppliedState), Buffer.from(savedState))) {
    return { statusCode: 400, headers, body: page('No se pudo conectar', 'La comprobación de seguridad ha caducado. Vuelve a la web y pulsa «Conectar YouTube» otra vez.') };
  }
  const clearCookie = 'yt_oauth_state=; Max-Age=0; Path=/.netlify/functions/youtube-callback; Secure; HttpOnly; SameSite=Lax';
  if (event.queryStringParameters?.error) return { statusCode: 400, headers: { ...headers, 'Set-Cookie': clearCookie }, body: page('Autorización cancelada', 'Google no ha concedido el permiso. Puedes volver atrás e intentarlo de nuevo.') };
  const code = event.queryStringParameters?.code;
  if (!code) return { statusCode: 400, headers: { ...headers, 'Set-Cookie': clearCookie }, body: page('Falta el código', 'Google no ha devuelto el código de autorización.') };
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { statusCode: 500, headers, body: page('Configuración incompleta', 'Faltan las credenciales OAuth en Netlify.') };
  try {
    const origin = new URL(event.rawUrl).origin;
    const redirectUri = origin + '/.netlify/functions/youtube-callback';
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || data.error || 'Google no pudo intercambiar el código.');
    if (!data.refresh_token) return { statusCode: 409, headers: { ...headers, 'Set-Cookie': clearCookie }, body: page('No llegó el token de actualización', 'Google no ha devuelto refresh_token. Vuelve a iniciar la conexión y asegúrate de elegir tu cuenta y aceptar el permiso. No se ha guardado ningún token.') };
    return { statusCode: 200, headers: { ...headers, 'Set-Cookie': clearCookie }, body: page('YouTube conectado', 'Copia este token y guárdalo como secreto en GitHub con el nombre exacto YOUTUBE_REFRESH_TOKEN.', data.refresh_token) };
  } catch (error) {
    return { statusCode: 400, headers: { ...headers, 'Set-Cookie': clearCookie }, body: page('No se pudo completar la conexión', 'Google ha rechazado el intercambio de autorización. Vuelve a intentarlo. Detalle: ' + String(error.message || 'error').replace(/[<>]/g, '')) };
  }
};
