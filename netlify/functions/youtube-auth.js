const crypto = require('node:crypto');

exports.handler = async (event) => {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { statusCode: 500, body: 'Faltan YOUTUBE_CLIENT_ID o YOUTUBE_CLIENT_SECRET en Netlify.' };
  const state = crypto.randomBytes(24).toString('hex');
  const origin = new URL(event.rawUrl).origin;
  const redirectUri = origin + '/.netlify/functions/youtube-callback';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  });
  return {
    statusCode: 302,
    headers: {
      Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(),
      'Set-Cookie': 'yt_oauth_state=' + state + '; Max-Age=600; Path=/.netlify/functions/youtube-callback; Secure; HttpOnly; SameSite=Lax',
      'Cache-Control': 'no-store'
    },
    body: ''
  };
};
