// twitch-api.js

// ============================================================
//  ОБЁРТКА: автоматический refresh при 401
// ============================================================
let _refreshInFlight = null;

async function _getFreshToken() {
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = (async () => {
    try {
      const auth = require('./auth');
      const tokens = await auth.forceRefreshToken();
      return tokens?.access_token || null;
    } catch (e) {
      console.warn('[twitch-api] refresh не удался:', e.message);
      return null;
    } finally {
      _refreshInFlight = null;
    }
  })();

  return _refreshInFlight;
}

// Обёртка: если запрос вернул 401 — обновляем токен и повторяем ОДИН раз
async function fetchWithRetry(url, options = {}, attempt = 1) {
  const res = await fetch(url, options);

  if (res.status === 401 && attempt <= 2) {
    console.warn(`[twitch-api] 401 — обновляю токен и повторяю запрос (attempt ${attempt})`);
    const newToken = await _getFreshToken();
    if (!newToken) return res;

    const newOptions = {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Authorization': `Bearer ${newToken}`,
      },
    };

    return fetchWithRetry(url, newOptions, attempt + 1);
  }

  return res;
}

// ============================================================
//  НАГРАДЫ ЗА БАЛЛЫ
// ============================================================
async function getCustomRewards({ token, clientId, broadcasterId }) {
  const url = `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${broadcasterId}&only_manageable_rewards=false`;
  const res = await fetchWithRetry(url, {
    headers: {
      'Client-Id': clientId,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get rewards failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.data || [];
}

async function findRewardByTitle({ token, clientId, broadcasterId, title }) {
  const rewards = await getCustomRewards({ token, clientId, broadcasterId });
  const lower = String(title).trim().toLowerCase();
  const found = rewards.find(r => r.title.trim().toLowerCase() === lower);
  return found || null;
}

// ============================================================
//  ANNOUNCEMENTS
// ============================================================
async function sendAnnouncement({ token, clientId, broadcasterId, moderatorId, message, color = 'primary' }) {
  const url = `https://api.twitch.tv/helix/chat/announcements?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`;

  const body = {
    message: String(message || '').slice(0, 500),
    color,
  };

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Client-Id': clientId,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Announcement failed: ${res.status} ${text.slice(0, 200)}`);
  }

  return { ok: true };
}

// ============================================================
//  VIP
// ============================================================
async function addChannelVip({ token, clientId, broadcasterId, userId }) {
  const url = `https://api.twitch.tv/helix/channels/vips?broadcaster_id=${broadcasterId}&user_id=${userId}`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Client-Id': clientId,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`addChannelVip failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return { ok: true };
}

async function removeChannelVip({ token, clientId, broadcasterId, userId }) {
  const url = `https://api.twitch.tv/helix/channels/vips?broadcaster_id=${broadcasterId}&user_id=${userId}`;
  const res = await fetchWithRetry(url, {
    method: 'DELETE',
    headers: {
      'Client-Id': clientId,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`removeChannelVip failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return { ok: true };
}

async function getChannelVips({ token, clientId, broadcasterId }) {
  const url = `https://api.twitch.tv/helix/channels/vips?broadcaster_id=${broadcasterId}&first=100`;
  const res = await fetchWithRetry(url, {
    headers: {
      'Client-Id': clientId,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getChannelVips failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.data || [];
}

async function getUserByLogin({ token, clientId, login }) {
  const cleanLogin = String(login || '').trim().toLowerCase().replace(/^@+/, '');
  if (!cleanLogin) throw new Error('Пустой логин');

  const url = `https://api.twitch.tv/helix/users?login=${encodeURIComponent(cleanLogin)}`;
  const res = await fetchWithRetry(url, {
    headers: {
      'Client-Id': clientId,
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getUserByLogin failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const user = data.data?.[0];
  if (!user) return null;

  return {
    id: user.id,
    login: user.login,
    displayName: user.display_name,
    profileImage: user.profile_image_url,
  };
}

module.exports = {
  fetchWithRetry,
  getCustomRewards,
  findRewardByTitle,
  sendAnnouncement,
  addChannelVip,
  removeChannelVip,
  getChannelVips,
  getUserByLogin,
};
