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
    this.connected = false;
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

      if (!userRes.ok) {
        const text = await userRes.text();
        throw new Error(`User API: ${userRes.status} ${text.slice(0, 200)}`);
      }

      const userData = await userRes.json();

      if (!userData?.data?.id) {
        throw new Error('Не удалось получить User ID: ' + JSON.stringify(userData).slice(0, 200));
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
    // Centrifugo v2 (старый протокол): используем params вместо connect
    this.pendingAuthId = this.send({
      params: { token: this.socketToken },
    });
  }

  async onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // === Ответ на авторизацию (Centrifugo v2: поле result) ===
    if (msg.id === this.pendingAuthId) {
      if (msg.error) {
        this.emit('error', 'Auth error: ' + JSON.stringify(msg.error));
        return;
      }

      if (!msg.result) {
        this.emit('error', 'Auth failed: no result in response');
        return;
      }

      this.clientId = msg.result.client;
      if (!this.clientId) {
        this.emit('error', 'Auth failed: no client id in result');
        return;
      }

      console.log('[donationalerts] Авторизация успешна. Client ID:', this.clientId);
      await this.subscribeToChannel();
      return;
    }

    // === Ответ на подписку (Centrifugo v2: поле result) ===
    if (msg.id === this.pendingSubscribeId) {
      if (msg.error) {
        this.emit('error', 'Subscribe error: ' + JSON.stringify(msg.error));
        return;
      }

      console.log('[donationalerts] Подписка на канал донатов активна');
      this.connected = true;
      this.emit('connected');

      // Пинг каждые 25 секунд (Centrifugo v2: method 0)
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        this.send({ method: 0 });
      }, 25000);
      return;
    }

    // === Pong (ответ на ping) ===
    if (msg.result === undefined && msg.id && !msg.push && !msg.error) {
      // Игнорируем пустые ответы на ping
      return;
    }

    // === Событие push с донатом ===
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

      if (!subRes.ok) {
        const text = await subRes.text();
        throw new Error(`Subscribe API: ${subRes.status} ${text.slice(0, 200)}`);
      }

      const subData = await subRes.json();
      const channels = subData?.channels || [];
      const entry = channels.find(c => c.channel === channelName);

      if (!entry?.token) {
        throw new Error('Не удалось получить subscription_token: ' + JSON.stringify(subData).slice(0, 200));
      }

      console.log('[donationalerts] Подписываюсь на канал:', channelName);

      // Centrifugo v2: method 1 = subscribe, params с channel и token
      this.pendingSubscribeId = this.send({
        method: 1,
        params: {
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
    this.connected = false;
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
