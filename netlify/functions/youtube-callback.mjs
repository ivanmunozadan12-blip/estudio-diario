import crypto from "node:crypto";

const REDIRECT_URI = "https://glistening-cascaron-b5b987.netlify.app/.netlify/functions/youtube-callback";

function page(title, body, status = 200) {
  return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>body{font:16px system-ui;background:#101713;color:#f1f5f2;margin:0;padding:24px}main{max-width:620px;margin:8vh auto;background:#1b2620;padding:24px;border-radius:16px}h1{font-size:24px}p{line-height:1.5;color:#c4d0c8}textarea{width:100%;min-height:110px;box-sizing:border-box;background:#0d120f;color:#fff;border:1px solid #526258;border-radius:8px;padding:12px}button{background:#ffc533;color:#1b1400;border:0;border-radius:8px;padding:12px 18px;font-weight:700;margin:12px 0}</style><main><h1>${title}</h1>${body}</main></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  });
}

function readCookie(header, name) {
  const item = (header || "").split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return item ? item.slice(name.length + 1) : "";
}

export default async function handler(request) {
  const url = new URL(request.url);
  const cookieState = readCookie(request.headers.get("cookie"), "yt_oauth_state");
  const returnedState = url.searchParams.get("state") || "";
  const clearCookie = "yt_oauth_state=; Path=/.netlify/functions; Max-Age=0; HttpOnly; Secure; SameSite=Lax";

  if (!cookieState || !returnedState || cookieState.length !== returnedState.length ||
      !crypto.timingSafeEqual(Buffer.from(cookieState), Buffer.from(returnedState))) {
    return new Response("Autorización no válida o caducada. Vuelve a empezar desde el enlace de conexión.", {
      status: 400, headers: { "Cache-Control": "no-store", "Set-Cookie": clearCookie }
    });
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return new Response("Google no ha concedido el acceso. Puedes cerrar esta página y volver a intentarlo.", {
      status: 400, headers: { "Cache-Control": "no-store", "Set-Cookie": clearCookie }
    });
  }

  const code = url.searchParams.get("code");
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!code || !clientId || !clientSecret) {
    return new Response("Falta el código de autorización o la configuración OAuth de Netlify.", {
      status: 500, headers: { "Cache-Control": "no-store", "Set-Cookie": clearCookie }
    });
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code"
    })
  });

  const tokens = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokens.refresh_token) {
    const reason = tokens.error === "redirect_uri_mismatch"
      ? "La URL de redirección no coincide con la registrada en Google Cloud."
      : "Google no ha devuelto un token de actualización. Vuelve a autorizar y asegúrate de aceptar todos los permisos.";
    return new Response(reason, { status: 400, headers: { "Cache-Control": "no-store", "Set-Cookie": clearCookie } });
  }

  const safeToken = String(tokens.refresh_token).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>YouTube conectado</title><style>body{font:16px system-ui;background:#101713;color:#f1f5f2;margin:0;padding:24px}main{max-width:620px;margin:8vh auto;background:#1b2620;padding:24px;border-radius:16px}h1{font-size:24px}p{line-height:1.5;color:#c4d0c8}textarea{width:100%;min-height:110px;box-sizing:border-box;background:#0d120f;color:#fff;border:1px solid #526258;border-radius:8px;padding:12px}button{background:#ffc533;color:#1b1400;border:0;border-radius:8px;padding:12px 18px;font-weight:700;margin:12px 0}</style><main><h1>Autorización de YouTube completada</h1><p>Guarda este token como secreto de GitHub llamado <b>YOUTUBE_REFRESH_TOKEN</b>. No lo compartas ni lo pegues en un chat. Esta página no lo guarda en Netlify.</p><textarea id="token" readonly>${safeToken}</textarea><button id="copy">Copiar token</button><p id="status">Después, vuelve a la configuración de secretos del repositorio GitHub.</p><script>document.getElementById('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.getElementById('token').value);document.getElementById('status').textContent='Token copiado. Pégalo directamente en el secreto de GitHub.'}catch(e){document.getElementById('token').focus();document.getElementById('token').select();document.getElementById('status').textContent='Selecciona y copia el token manualmente.'}})</script></main></html>`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": clearCookie,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  });
}
