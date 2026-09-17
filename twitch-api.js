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

module.exports = { getCustomRewards, findRewardByTitle, sendAnnouncement };
