// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const open = require('open');

const auth = require('./auth');
const db = require('./db');
const mechanics = require('./mechanics');
const { TwitchService } = require('./twitch');
const { TwitchEventSub } = require('./twitch-eventsub');
const { DonatePayService } = require('./donatepay');
const { getCustomRewards } = require('./twitch-api');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let twitch = null;
let eventSub = null;
let donatePay = null;
let pendingState = null;
const ircState = { connected: false };
const donatPayState = { connected: false };

const ctx = {
  broadcast: (type, payload) => {
    const msg = JSON.stringify({ type, payload });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  },
  db,
};

const { checkForUpdate, CURRENT_VERSION } = require('./updater');

// === Автообновление (запускается параллельно, не блокирует старт) ===
(async () => {
  try {
    const result = await checkForUpdate({ silent: false });
    if (result.restartRequired) {
      console.log('🔄 Доступно обновление! Перезапусти приложение для применения.');
    }
  } catch (e) {
    console.warn('⚠️ updater:', e.message);
  }
})();

console.log(`📦 Twitch Overlay v${CURRENT_VERSION}`);

mechanics.initAll(ctx);

// === WebSocket ===
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', payload: mechanics.getFullState() }));
  ws.send(JSON.stringify({ type: 'twitchStatus', payload: ircState }));
  ws.send(JSON.stringify({ type: 'donatePayStatus', payload: donatPayState }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || !msg.action) return;

    const result = mechanics.handleCommand(msg.action, msg.data);
    if (result?.error) {
      ws.send(JSON.stringify({ type: 'error', payload: { action: msg.action, message: result.error } }));
    }
  });
});

// === История ===
app.get('/api/history', (req, res) => res.json(db.loadHistory()));
app.delete('/api/history', (req, res) => { db.clearHistory(); res.json({ ok: true }); });

// === Настройки ===
app.get('/api/settings', (req, res) => {
  const d = db.loadData();
  res.json({
    ticketRewardId: d.settings.ticketRewardId || '',
    ticketRewardTitle: d.settings.ticketRewardTitle || '',
    hasDonatePayToken: !!d.settings.donatePayToken,
  });
});

// Список всех кастомных награда канала
app.get('/api/rewards', async (req, res) => {
  const d = db.loadData();
  if (!d.tokens || !d.tokens.access_token) {
    return res.status(400).json({ error: 'Не авторизован в Twitch' });
  }
  try {
    const rewards = await getCustomRewards({
      token: d.tokens.access_token,
      clientId: auth.CLIENT_ID,
      broadcasterId: d.tokens.user_id,
    });
    res.json({
      rewards: rewards.map(r => ({ id: r.id, title: r.title, cost: r.cost })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/settings', (req, res) => {
  const { ticketRewardId, ticketRewardTitle, donatePayToken } = req.body || {};
  const patch = {};

  if (typeof ticketRewardId === 'string') patch.ticketRewardId = ticketRewardId.trim() || null;
  if (typeof ticketRewardTitle === 'string') patch.ticketRewardTitle = ticketRewardTitle.trim() || null;
  if (typeof donatePayToken === 'string') patch.donatePayToken = donatePayToken.trim() || null;

  db.update(d => { Object.assign(d.settings, patch); });

  if (patch.donatePayToken !== undefined) startDonatePay();

  res.json({ ok: true, ticketRewardId: patch.ticketRewardId || undefined });
});

// === Auth ===
app.get('/auth/login', (req, res) => {
  pendingState = crypto.randomBytes(16).toString('hex');
  res.redirect(auth.getAuthUrl(pendingState));
});

app.get('/auth/callback', async (req, res) => {
  const { code, state: returnedState } = req.query;
  if (returnedState !== pendingState) return res.status(400).send('Invalid state');
  pendingState = null;

  try {
    const tokens = await auth.exchangeCode(code);
    const info = await auth.validateToken(tokens.access_token);

    db.update(d => {
      d.tokens = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + tokens.expires_in * 1000,
        user_id: info.user_id,
        login: info.login,
      };
      d.settings.channel = info.login;
    });

    await restartTwitch();
    await restartEventSub();
    res.redirect('/');
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).send('Ошибка авторизации: ' + err.message);
  }
});

app.get('/api/status', (req, res) => {
  const data = db.loadData();
  res.json({
    authorized: !!data.tokens,
    login: data.tokens?.login || null,
    channel: data.settings.channel,
    ircConnected: ircState.connected,
    donatePayConnected: donatPayState.connected,
  });
});

app.get('/api/logout', (req, res) => {
  db.update(d => { d.tokens = null; d.settings.channel = null; });
  if (twitch) { twitch.disconnect(); twitch = null; }
  if (eventSub) { eventSub.disconnect(); eventSub = null; }
  ircState.connected = false;
  res.redirect('/');
});

// === Twitch IRC ===
async function restartTwitch() {
  if (twitch) { await twitch.disconnect(); twitch = null; }
  const data = db.loadData();
  if (!data.tokens || !data.settings.channel) return;

  twitch = new TwitchService({
    username: data.tokens.login,
    token: data.tokens.access_token,
    channel: data.settings.channel,
  });

  twitch.on('chat', (msg) => {
    mechanics.handleChat(msg);
    ctx.broadcast('chat', msg);
  });
  twitch.on('connected', () => {
    ircState.connected = true;
    ctx.broadcast('twitchStatus', ircState);
  });
  twitch.on('disconnected', (reason) => {
    ircState.connected = false;
    ctx.broadcast('twitchStatus', { ...ircState, reason });
  });

  try { await twitch.connect(); }
  catch (e) { console.error('IRC connect error:', e.message); }
}

// === EventSub (билеты) ===
async function restartEventSub() {
  if (eventSub) { eventSub.disconnect(); eventSub = null; }
  const data = db.loadData();
  if (!data.tokens) return;

  eventSub = new TwitchEventSub({
    token: data.tokens.access_token,
    clientId: auth.CLIENT_ID,
    userId: data.tokens.user_id,
  });

  eventSub.on('connected', () => console.log('✅ EventSub подключён'));
  eventSub.on('subscribed', (type) => console.log('📌 EventSub подписка:', type));
  eventSub.on('error', (msg) => console.warn('⚠️ EventSub:', msg));
  eventSub.on('disconnected', () => console.log('⚠️ EventSub отключён, реконнект...'));

  eventSub.on('event', ({ type, event }) => {
    if (type === 'channel.channel_points_custom_reward_redemption.add') {
      const result = mechanics.tickets.addFromRedemption({
        userId: event.user_id,
        username: event.user_name || event.user_login,
        rewardId: event.reward?.id,
        redeemedAt: new Date(event.redeemed_at).getTime(),
      });
      console.log('🎟️ Билет:', event.user_name, result);
    }
  });

  eventSub.connect();
}

// === DonatePay ===
function startDonatePay() {
  if (donatePay) { donatePay.disconnect(); donatePay = null; }

  const data = db.loadData();
  if (!data.settings.donatePayToken) {
    donatPayState.connected = false;
    ctx.broadcast('donatePayStatus', donatPayState);
    return;
  }

  donatePay = new DonatePayService({ token: data.settings.donatePayToken });

  donatePay.on('connected', () => {
    donatPayState.connected = true;
    ctx.broadcast('donatePayStatus', donatPayState);
    console.log('✅ DonatePay подключён');
  });

  donatePay.on('disconnected', () => {
    donatPayState.connected = false;
    ctx.broadcast('donatePayStatus', donatPayState);
  });

  donatePay.on('error', (msg) => console.warn('⚠️ DonatePay:', msg));

  donatePay.on('donation', (donation) => {
    console.log('💸 Донат:', donation);
    mechanics.donors.addDonor(donation);
  });

  donatePay.connect();
}

// === Старт ===
(async () => {
  const tokens = await auth.ensureFreshToken();
  if (tokens) {
    await restartTwitch();
    await restartEventSub();
  } else {
    console.log('⚠️  Требуется авторизация через Twitch');
  }

  startDonatePay();

  server.listen(3000, async () => {
    console.log('🚀 Сервер: http://localhost:3000');
    console.log('   Панель:            http://localhost:3000/');
    console.log('   Оверлей keyword:   http://localhost:3000/overlay-keyword.html');
    console.log('   Оверлей wheel:     http://localhost:3000/overlay-wheel.html');
    console.log('   Оверлей sniper:    http://localhost:3000/overlay-sniper.html');
    console.log('   Оверлей winner:    http://localhost:3000/overlay-winner.html');
    await open('http://localhost:3000');
  });
})();