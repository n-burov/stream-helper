// auth.js
const db = require('./db');

const CLIENT_ID = '6r23dqsif3hfl3tnta192qhka2cns1';
const CLIENT_SECRET = 'eop4kxesklztrkkdlf1k4u3f8jzsen';
const REDIRECT_URI = 'http://localhost:3000/auth/callback';

const SCOPES = [
  'chat:read',
  'chat:edit',
  'moderator:manage:announcements',
  'moderator:read:followers',
  'channel:read:redemptions',
  'channel:read:vips',
  'channel:manage:vips',
  'channel:read:subscriptions',
].join(' ');

function loadData() {
  return db.loadData();
}

function saveData(data) {
  db.saveData();
}

function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  return `https://id.twitch.tv/oauth2/authorize?${params}`;
}

async function exchangeCode(code) {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function refreshToken(refresh_token) {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
  return res.json();
}

async function validateToken(access_token) {
  const res = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${access_token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// === Проверяем, скоро ли истекает токен ===
function isTokenExpiringSoon(bufferMs = 30 * 60 * 1000) {
  const data = db.loadData();
  if (!data.tokens?.expires_at) return true;
  return Date.now() > data.tokens.expires_at - bufferMs;
}

// === Принудительный refresh (без validate) ===
async function forceRefreshToken() {
  const data = db.loadData();
  if (!data.tokens?.refresh_token) {
    console.warn('[auth] нет refresh_token, обновление невозможно');
    return null;
  }

  try {
    const refreshed = await refreshToken(data.tokens.refresh_token);
    db.update(d => {
      d.tokens = {
        ...d.tokens,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token || d.tokens.refresh_token,
        expires_at: Date.now() + refreshed.expires_in * 1000,
      };
    });
    console.log('[auth] ✅ токен обновлён (refresh)');
    return db.loadData().tokens;
  } catch (e) {
    console.error('[auth] ❌ не удалось обновить токен:', e.message);
    db.update(d => { d.tokens = null; });
    return null;
  }
}

// === Умная проверка: если скоро истечёт — обновляем, иначе отдаём как есть ===
async function ensureTokenFresh(bufferMs = 30 * 60 * 1000) {
  const data = db.loadData();
  if (!data.tokens?.access_token) return null;

  if (isTokenExpiringSoon(bufferMs)) {
    return await forceRefreshToken();
  }
  return data.tokens;
}

// === Совместимость: старый вызов ensureFreshToken (валидирует через Twitch) ===
async function ensureFreshToken() {
  const data = db.loadData();
  if (!data.tokens || !data.tokens.access_token) return null;

  const info = await validateToken(data.tokens.access_token);
  if (info) return data.tokens;

  // Токен протух — пробуем обновить
  if (!data.tokens.refresh_token) {
    db.update(d => { d.tokens = null; });
    return null;
  }

  return await forceRefreshToken();
}

module.exports = {
  getAuthUrl, exchangeCode, refreshToken, validateToken,
  ensureFreshToken, ensureTokenFresh, forceRefreshToken, isTokenExpiringSoon,
  CLIENT_ID, REDIRECT_URI,
};
