// donationalerts-auth.js
const crypto = require('crypto');

// ЗАМЕНИ НА СВОИ ЗНАЧЕНИЯ ИЗ ЛИЧНОГО КАБИНЕТА DA
const DA_CLIENT_ID = '21169';
const DA_CLIENT_SECRET = 'pkqLH26wl7p27p85S8BG5iLovrd40geJqYDVJoKv';
const DA_REDIRECT_URI = 'http://localhost:3000/auth/donationalerts/callback';

const DA_AUTHORIZE_URL = 'https://www.donationalerts.com/oauth/authorize';
const DA_TOKEN_URL = 'https://www.donationalerts.com/oauth/token';

// Ключевой scope для подписки на донаты
const DA_SCOPES = 'oauth-user-show oauth-donation-subscribe';

function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: DA_CLIENT_ID,
    redirect_uri: DA_REDIRECT_URI,
    response_type: 'code',
    scope: DA_SCOPES,
    state: state,
  });
  return `${DA_AUTHORIZE_URL}?${params}`;
}

async function exchangeCode(code) {
  const res = await fetch(DA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      client_id: DA_CLIENT_ID,
      client_secret: DA_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: DA_REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DA token exchange failed: ${res.status} ${text}`);
  }

  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

async function refreshToken(refresh_token) {
  const res = await fetch(DA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      client_id: DA_CLIENT_ID,
      client_secret: DA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refresh_token,
    }),
  });

  if (!res.ok) throw new Error(`DA refresh failed: ${res.status}`);
  return res.json();
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  refreshToken,
  DA_CLIENT_ID,
  DA_REDIRECT_URI,
};
