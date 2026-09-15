// donationalerts.js
const WebSocket = require('ws');
const EventEmitter = require('events');

const WS_URL = 'wss://centrifugo.donationalerts.com/connection/websocket';
const API_BASE = 'https://www.donationalerts.com/api/v1';

class DonationAlertsService extends EventEmitter {
  constructor({ accessToken }) {
    super();
    this.accessToken = accessToken;
    this.ws = null;
    this.userId = null;
    this.socketToken = null;
    this.clientId = null;
    this.pingInterval = null;
    this.reconnectTimeout = null;
    this.shouldReconnect = true;
    this.msgId = 0;
    this.pendingAuthId = null;
    this.pendingSubscribeId = null;
    this.processedDonations = new Set();
  }

  async start() {
    this.shouldReconnect = true;

    try {
      // 1. Получаем User ID и socket_connection_token
      const userRes = await fetch(`${API_BASE}/user/oauth`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
        },
      });

      const userData = await userRes.json();

      if (!userData?.data?.id) {
        throw new Error('Не удалось получить User ID от DonationAlerts: ' + JSON.stringify(userData).slice(0, 200));
      }

      this.userId = userData.data.id;
      this.socketToken = userData.data.socket_connection_token;

      if (!this.socketToken) {
        throw new Error('Не удалось получить socket_connection_token');
      }

      console.log('[donationalerts] User ID:', this.userId, '— socket token получен');

      this.openSocket();
    } catch (e) {
      this.emit('error', 'Авторизация: ' + e.message);
      this.scheduleReconnect(15000);
    }
  }

  openSocket() {
    console.log('[donationalerts] Открываю WebSocket...');
    this.ws = new WebSocket(WS_URL, { perMessageDeflate: false });

    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (data) => this.onMessage(data));
    this.ws.on('close', () => this.onClose());
    this.ws.on('error', (err) => this.emit('error', 'WS: ' + err.message));
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      this.msgId++;
      const id = this.msgId;
      const message = JSON.stringify({ id, ...obj });
      this.ws.send(message);
      return id;
    }
    return null;
  }

  onOpen() {
    console.log('[donationalerts] WebSocket открыт, авторизация...');
    this.pendingAuthId = this.send({
      connect: { token: this.socketToken },
    });
  }

  async onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // === Ответ на connect ===
    if (msg.id === this.pendingAuthId && msg.connect) {
      if (msg.connect.error) {
        this.emit('error', 'Connect error: ' + JSON.stringify(msg.connect.error));
        return;
      }

      this.clientId = msg.connect.client;
      console.log('[donationalerts] Авторизация успешна. Client ID:', this.clientId);

      // Дальше — подписка на канал
      await this.subscribeToChannel();
      return;
    }

    // === Ответ на subscribe ===
    if (msg.id === this.pendingSubscribeId && msg.subscribe) {
      if (msg.subscribe.error) {
        this.emit('error', 'Subscribe error: ' + JSON.stringify(msg.subscribe.error));
        return;
      }

      console.log('[donationalerts] Подписка на канал донатов активна');
      this.emit('connected');

      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        this.send({ ping: {} });
      }, 25000);
      return;
    }

    if (msg.pong) return;

    // === Событие нового доната ===
    if (msg.push && msg.push.pub && msg.push.pub.data) {
      const data = msg.push.pub.data;

      if (this.processedDonations.has(data.id)) return;
      this.processedDonations.add(data.id);
      if (this.processedDonations.size > 1000) {
        const first = this.processedDonations.values().next().value;
        this.processedDonations.delete(first);
      }

      const donation = {
        id: data.id,
        name: data.username || 'Аноним',
        amount: parseFloat(data.amount) || 0,
        currency: data.currency || 'RUB',
        message: data.message || '',
        at: Date.now(),
      };

      console.log('[donationalerts] Новый донат:', donation);
      this.emit('donation', donation);
    }
  }

  async subscribeToChannel() {
    try {
      const channelName = `$alerts:donation_${this.userId}`;

      // Получаем subscription_token для канала
      const subRes = await fetch(`${API_BASE}/centrifuge/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({
          client: this.clientId,
          channels: [channelName],
        }),
      });

      const subData = await subRes.json();

      // Ответ: { channels: [{ channel, token }] }
      const channels = subData?.channels || [];
      const entry = channels.find(c => c.channel === channelName);
      if (!entry?.token) {
        throw new Error('Не удалось получить subscription_token: ' + JSON.stringify(subData).slice(0, 200));
      }

      console.log('[donationalerts] Подписываюсь на канал:', channelName);

      this.pendingSubscribeId = this.send({
        subscribe: {
          channel: channelName,
          token: entry.token,
        },
      });
    } catch (e) {
      this.emit('error', 'Ошибка получения токена подписки: ' + e.message);
      this.scheduleReconnect(10000);
    }
  }

  onClose() {
    console.log('[donationalerts] WebSocket закрыт');
    this.emit('disconnected');
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.shouldReconnect) this.scheduleReconnect(5000);
  }

  scheduleReconnect(delayMs = 5000) {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.shouldReconnect) this.start();
    }, delayMs);
  }

  stop() {
    this.shouldReconnect = false;
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
    this.ws = null;
  }
}

module.exports = { DonationAlertsService };
