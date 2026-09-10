// auth.js
const fs = require('fs');
const path = require('path');

const CLIENT_ID = '6r23dqsif3hfl3tnta192qhka2cns1';
const CLIENT_SECRET = 'eop4kxesklztrkkdlf1k4u3f8jzsen';
const REDIRECT_URI = 'http://localhost:3000/auth/callback';

const SCOPES = [
  'chat:read',
  'chat:edit',
  'moderator:read:followers',
  'channel:read:redemptions',
  'channel:read:vips',
  'channel:read:subscriptions',
].join(' ');

const isPkg = typeof process.pkg !== 'undefined';
const BASE_DIR = isPkg ? path.dirname(process.execPath) : __dirname;
const DATA_FILE = path.join(BASE_DIR, 'data.json');

const DEFAULT_DATA = {
  tokens: null,
  settings: { channel: null },
  follows: [],
  redemptions: [],
};

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { ...DEFAULT_DATA };
  try {
    return { ...DEFAULT_DATA, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function saveData(data) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
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

async function ensureFreshToken() {
  const data = loadData();
  if (!data.tokens) return null;
  const info = await validateToken(data.tokens.access_token);
  if (info) return data.tokens;
  try {
    const refreshed = await refreshToken(data.tokens.refresh_token);
    data.tokens = {
      ...data.tokens,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: Date.now() + refreshed.expires_in * 1000,
    };
    saveData(data);
    return data.tokens;
  } catch {
    data.tokens = null;
    saveData(data);
    return null;
  }
}

module.exports = {
  loadData, saveData,
  getAuthUrl, exchangeCode, refreshToken, validateToken, ensureFreshToken,
  CLIENT_ID, REDIRECT_URI, BASE_DIR,
};