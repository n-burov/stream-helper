// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const open = require('open');

const auth = require('./auth');
const daAuth = require('./donationalerts-auth');
const db = require('./db');
const mechanics = require('./mechanics');
const { TwitchService } = require('./twitch');
const { TwitchEventSub } = require('./twitch-eventsub');
const { DonationAlertsService } = require('./donationalerts');
const { getCustomRewards } = require('./twitch-api');
const { checkForUpdate, CURRENT_VERSION } = require('./updater');

console.log(`📦 Twitch Overlay v${CURRENT_VERSION}`);

// === Автообновление (до старта сервера) ===
(async () => {
  console.log('[boot] Проверяю обновления...');
  try {
    const result = await checkForUpdate();
    console.log('[boot] updater result:', JSON.stringify(result));
  } catch (e) {
    console.warn('[boot] updater error:', e.message);
  }

  console.log('[boot] Запускаю приложение...');
  await startApp();
})().catch((e) => {
  console.error('[boot] FATAL:', e);
  process.exit(1);
});

async function startApp() {
  const app = express();
  app.use(express.json());

  // Отключаем Range-запросы — они ломают раздачу видео в OBS
  app.use(express.static(path.join(__dirname, 'public'), {
    acceptRanges: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.webm') || filePath.endsWith('.mov') || filePath.endsWith('.mp4')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  let twitch = null;
  let eventSub = null;
  let donationAlerts = null;
  let pendingState = null;
  let pendingDaState = null;
  const ircState = { connected: false };
  const daState = { connected: false };

  const ctx = {
    broadcast: (type, payload) => {
      const msg = JSON.stringify({ type, payload });
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(msg);
      }
    },
    db,
    twitch: null,
  };

  mechanics.initAll(ctx);

  // Проверка недельного сброса донатеров
  try {
    mechanics.donors.checkWeeklyReset();
  } catch (e) {
    console.warn('⚠️ Ошибка weekly-сброса:', e.message);
  }

  // Проверка месячного сброса топов
  try {
    mechanics.tops.checkMonthlyReset();
  } catch (e) {
    console.warn('⚠️ Ошибка monthly-сброса топов:', e.message);
  }

  // Раз в час проверяем смену месяца
  setInterval(() => {
    try { mechanics.tops.checkMonthlyReset(); } catch {}
  }, 60 * 60 * 1000);

  // === WebSocket ===
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'state', payload: mechanics.getFullState() }));
    ws.send(JSON.stringify({ type: 'twitchStatus', payload: ircState }));
    ws.send(JSON.stringify({ type: 'donationAlertsStatus', payload: daState }));

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
    });
  });

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
        available: true,
        rewards: rewards.map(r => ({ id: r.id, title: r.title, cost: r.cost })),
      });
    } catch (e) {
      const isAffiliateError = e.message.includes('partner or affiliate status');
      res.json({
        available: false,
        reason: isAffiliateError
          ? 'Канал не имеет статуса Affiliate или Partner.'
          : e.message,
        rewards: [],
      });
    }
  });

  app.post('/api/settings', (req, res) => {
    const { ticketRewardId, ticketRewardTitle } = req.body || {};
    const patch = {};

    if (typeof ticketRewardId === 'string') patch.ticketRewardId = ticketRewardId.trim() || null;
    if (typeof ticketRewardTitle === 'string') patch.ticketRewardTitle = ticketRewardTitle.trim() || null;

    db.update(d => { Object.assign(d.settings, patch); });

    res.json({ ok: true, ticketRewardId: patch.ticketRewardId || undefined });
  });

  // === Twitch Auth ===
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

  // === DonationAlerts Auth ===
  app.get('/auth/donationalerts/login', (req, res) => {
    pendingDaState = crypto.randomBytes(16).toString('hex');
    res.redirect(daAuth.getAuthUrl(pendingDaState));
  });

  app.get('/auth/donationalerts/callback', async (req, res) => {
    const { code, state } = req.query;
    if (state !== pendingDaState) {
      return res.status(400).send('Invalid state');
    }
    pendingDaState = null;

    try {
      const tokens = await daAuth.exchangeCode(code);

      db.update(d => {
        d.settings.donationAlertsToken = tokens.access_token;
        d.settings.donationAlertsRefreshToken = tokens.refresh_token;
        d.settings.donationAlertsExpiresAt = Date.now() + tokens.expires_in * 1000;
      });

      console.log('✅ DonationAlerts авторизован');
      await startDonationAlerts();
      res.redirect('/');
    } catch (err) {
      console.error('DA auth error:', err);
      res.status(500).send('Ошибка авторизации DonationAlerts: ' + err.message);
    }
  });

  app.get('/api/logout/donationalerts', (req, res) => {
    db.update(d => {
      d.settings.donationAlertsToken = null;
      d.settings.donationAlertsRefreshToken = null;
      d.settings.donationAlertsExpiresAt = null;
    });
    if (donationAlerts) { donationAlerts.stop(); donationAlerts = null; }
    daState.connected = false;
    ctx.broadcast('donationAlertsStatus', daState);
    res.redirect('/');
  });

  app.get('/api/status', (req, res) => {
    const data = db.loadData();
    res.json({
      authorized: !!data.tokens,
      login: data.tokens?.login || null,
      channel: data.settings.channel,
      ircConnected: ircState.connected,
      donationAlertsAuthorized: !!data.settings.donationAlertsToken,
      donationAlertsConnected: daState.connected,
    });
  });

  app.get('/api/logout', (req, res) => {
    db.update(d => { d.tokens = null; d.settings.channel = null; });
    if (twitch) { twitch.disconnect(); twitch = null; }
    if (eventSub) { eventSub.disconnect(); eventSub = null; }
    ctx.twitch = null;
    ircState.connected = false;
    ctx.broadcast('twitchStatus', ircState);
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
      userId: data.tokens.user_id,     // ← добавили
      clientId: auth.CLIENT_ID,         // ← добавили
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
      ctx.twitch = null;
      ctx.broadcast('twitchStatus', { ...ircState, reason });
    });

    try {
      await twitch.connect();
      ctx.twitch = twitch;
    } catch (e) {
      console.error('IRC connect error:', e.message);
    }
  }

  // === EventSub ===
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

        mechanics.dj.addRedemption({
          userId: event.user_id,
          username: event.user_name || event.user_login,
          rewardId: event.reward?.id,
          cost: event.reward?.cost,
        });
      }

      if (type === 'stream.offline') {
        console.log('📴 Стрим завершён — сбрасываю Диджея дня и Топ дня');
        mechanics.dj.reset();
        mechanics.tops.resetDaily();
      }

      if (type === 'stream.online') {
        console.log('📺 Стрим начался — сбрасываю Диджея дня и Топ дня');
        mechanics.dj.reset();
        mechanics.tops.resetDaily();
      }
    });

    eventSub.connect();
  }

  // === DonationAlerts ===
  async function startDonationAlerts() {
    if (donationAlerts) { donationAlerts.stop(); donationAlerts = null; }

    const data = db.loadData();
    let token = data.settings.donationAlertsToken;

    if (!token) {
      daState.connected = false;
      ctx.broadcast('donationAlertsStatus', daState);
      return;
    }

    const expiresAt = data.settings.donationAlertsExpiresAt || 0;
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      try {
        const refreshed = await daAuth.refreshToken(data.settings.donationAlertsRefreshToken);
        token = refreshed.access_token;
        db.update(d => {
          d.settings.donationAlertsToken = refreshed.access_token;
          d.settings.donationAlertsRefreshToken = refreshed.refresh_token;
          d.settings.donationAlertsExpiresAt = Date.now() + refreshed.expires_in * 1000;
        });
        console.log('🔄 DonationAlerts токен обновлён');
      } catch (e) {
        console.warn('⚠️ Не удалось обновить токен DonationAlerts:', e.message);
        daState.connected = false;
        ctx.broadcast('donationAlertsStatus', daState);
        return;
      }
    }

    donationAlerts = new DonationAlertsService({ accessToken: token });

    donationAlerts.on('connected', () => {
      daState.connected = true;
      ctx.broadcast('donationAlertsStatus', daState);
      console.log('✅ DonationAlerts подключён');
    });

    donationAlerts.on('disconnected', () => {
      daState.connected = false;
      ctx.broadcast('donationAlertsStatus', daState);
    });

    donationAlerts.on('error', (msg) => console.warn('⚠️ DonationAlerts:', msg));

    donationAlerts.on('donation', (donation) => {
      mechanics.donors.addDonor(donation);
      mechanics.tops.addDonation(donation);

      const AMOUNT_THRESHOLD = 200;
      const currency = (donation.currency || 'RUB').toUpperCase();
      const amount = Number(donation.amount) || 0;

      if (currency === 'RUB' && amount >= AMOUNT_THRESHOLD) {
        console.log(`🎡 Донат ${amount}₽ от ${donation.name} — запускаю колесо`);
        try {
          const result = mechanics.wheel.spin({
            donorName: donation.name,
            donorAmount: amount,
          });
          if (result?.error) {
            console.warn('⚠️ Не удалось запустить колесо:', result.error);
          } else if (result?.queued) {
            console.log(`[wheel] донат от ${donation.name} в очереди (позиция ${result.queueSize})`);
          }
        } catch (e) {
          console.warn('⚠️ Ошибка автокрутки:', e.message);
        }
      }
    });

    donationAlerts.start();
  }

  // === Подключение к Twitch и запуск сервера ===
  const tokens = await auth.ensureFreshToken();
  if (tokens) {
    await restartTwitch();
    await restartEventSub();
  } else {
    console.log('⚠️  Требуется авторизация через Twitch');
  }

  await startDonationAlerts();

  server.listen(3000, async () => {
    console.log('🚀 Сервер: http://localhost:3000');
    console.log('   Панель:            http://localhost:3000/');
    console.log('   Оверлей keyword:   http://localhost:3000/overlay-keyword.html');
    console.log('   Оверлей wheel:     http://localhost:3000/overlay-wheel.html');
    console.log('   Оверлей sniper:    http://localhost:3000/overlay-sniper.html');
    console.log('   Оверлей winner:    http://localhost:3000/overlay-winner.html');
    console.log('   Оверлей Топы:      http://localhost:3000/overlay-dj.html');
    await open('http://localhost:3000');
  });
}
