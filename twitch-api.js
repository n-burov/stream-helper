// twitch-api.js
// Минимальный клиент Helix API для операций с наградами

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
    throw new Error(`Get rewards failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.data || []; // [{ id, title, cost, prompt, ... }]
}

async function findRewardByTitle({ token, clientId, broadcasterId, title }) {
  const rewards = await getCustomRewards({ token, clientId, broadcasterId });
  const lower = String(title).trim().toLowerCase();
  const found = rewards.find(r => r.title.trim().toLowerCase() === lower);
  return found || null;
}

module.exports = { getCustomRewards, findRewardByTitle };