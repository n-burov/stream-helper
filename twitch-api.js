// twitch-api.js

async function getCustomRewards({ token, clientId, broadcasterId }) {
  const url = `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${broadcasterId}&only_manageable_rewards=false`;
  const res = await fetch(url, {
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

// Отправка announcement через Helix API
async function sendAnnouncement({ token, clientId, broadcasterId, moderatorId, message, color = 'primary' }) {
  const url = `https://api.twitch.tv/helix/chat/announcements?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`;

  const body = {
    message: String(message || '').slice(0, 500),
    color,
  };

  const res = await fetch(url, {
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

// Выдать VIP на канале
async function addChannelVip({ token, clientId, broadcasterId, userId }) {
  const url = `https://api.twitch.tv/helix/channels/vips?broadcaster_id=${broadcasterId}&user_id=${userId}`;
  const res = await fetch(url, {
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

// Снять VIP на канале
async function removeChannelVip({ token, clientId, broadcasterId, userId }) {
  const url = `https://api.twitch.tv/helix/channels/vips?broadcaster_id=${broadcasterId}&user_id=${userId}`;
  const res = await fetch(url, {
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

// Получить список VIP на канале
async function getChannelVips({ token, clientId, broadcasterId }) {
  const url = `https://api.twitch.tv/helix/channels/vips?broadcaster_id=${broadcasterId}&first=100`;
  const res = await fetch(url, {
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

// Получить Twitch-юзера по логину (нику)
// Возвращает { id, login, displayName, profileImage } или null
async function getUserByLogin({ token, clientId, login }) {
  const cleanLogin = String(login || '').trim().toLowerCase().replace(/^@+/, '');
  if (!cleanLogin) throw new Error('Пустой логин');

  const url = `https://api.twitch.tv/helix/users?login=${encodeURIComponent(cleanLogin)}`;
  const res = await fetch(url, {
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
  getCustomRewards,
  findRewardByTitle,
  sendAnnouncement,
  addChannelVip,
  removeChannelVip,
  getChannelVips,
  getUserByLogin,
};
