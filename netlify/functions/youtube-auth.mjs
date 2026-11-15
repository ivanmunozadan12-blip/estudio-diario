import crypto from "node:crypto";

const REDIRECT_URI = "https://glistening-cascaron-b5b987.netlify.app/.netlify/functions/youtube-callback";
const SCOPE = "https://www.googleapis.com/auth/youtube.upload";

export default async function handler() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) return new Response("Falta configurar YOUTUBE_CLIENT_ID en Netlify.", { status: 500 });

  const state = crypto.randomBytes(32).toString("hex");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state
  }).toString();

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Set-Cookie": `yt_oauth_state=${state}; Path=/.netlify/functions; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
}
