// donatepay.js
const WebSocket = require('ws');
const EventEmitter = require('events');

const API_BASE = 'https://donatepay.ru/api/v1';
const WS_URL = 'wss://centrifugo.donatepay.ru:443/connection/websocket';

class DonatePayService extends EventEmitter {
  constructor({ token }) {
    super();
    this.token = token;
    this.ws = null;
    this.userId = null;
    this.channelToken = null;
    this.pingInterval = null;
    this.reconnectTimeout = null;
    this.shouldReconnect = true;
    this.msgId = 0;
  }

  async connect() {
    this.shouldReconnect = true;

    try {
      // 1. Получаем userId через API
      const userRes = await fetch(`${API_BASE}/user?access_token=${encodeURIComponent(this.token)}`);
      const userData = await userRes.json();
      if (userData?.data?.id) {
        this.userId = userData.data.id;
      } else if (userData?.id) {
        this.userId = userData.id;
      } else {
        throw new Error('Не удалось получить userId');
      }

      // 2. Получаем socket-токен
      const tokenRes = await fetch(`https://donatepay.ru/api/v2/socket/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: this.token }),
      });
      const tokenData = await tokenRes.json();
      this.channelToken = tokenData?.token || tokenData?.data?.token;
      if (!this.channelToken) throw new Error('Не удалось получить socket-токен');

      // 3. Открываем WS
      this.openSocket();
    } catch (e) {
      this.emit('error', e.message);
      this.scheduleReconnect();
    }
  }

  openSocket() {
    this.ws = new WebSocket(WS_URL, { perMessageDeflate: false });

    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (data) => this.onMessage(data));
    this.ws.on('close', () => this.onClose());
    this.ws.on('error', (err) => this.emit('error', err.message));
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      this.msgId++;
      this.ws.send(JSON.stringify({ id: this.msgId, ...obj }));
    }
  }

  onOpen() {
    // Centrifugo handshake — шлём connect с нашим токеном
    this.send({ connect: { token: this.channelToken } });
  }

  onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // Ответ на connect
    if (msg.connect || (msg.id === 1 && msg.result)) {
      this.emit('connected');

      // Подписываемся на публичный канал пользователя
      this.send({
        subscribe: {
          channel: `$public:${this.userId}`,
        },
      });

      // Пинг каждые 25 сек, чтобы не отвалилось
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        this.send({ ping: {} });
      }, 25000);
      return;
    }

    // Событие push с донатом
    if (msg.push && msg.push.pub && msg.push.pub.data) {
      const payload = msg.push.pub.data;
      const notification = payload?.data?.notification || payload?.notification;

      if (notification && notification.vars) {
        this.emit('donation', {
          id: notification.id,
          name: notification.vars.name || 'Аноним',
          amount: Number(notification.vars.sum) || 0,
          currency: notification.vars.currency || 'RUB',
          message: notification.vars.comment || '',
          at: Date.now(),
        });
      }
    }
  }

  onClose() {
    this.emit('disconnected');
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.shouldReconnect) this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.shouldReconnect) this.connect();
    }, 5000);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) { try { this.ws.close(); } catch {} }
    this.ws = null;
  }
}

module.exports = { DonatePayService };