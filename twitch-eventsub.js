// twitch-eventsub.js
const WebSocket = require('ws');
const EventEmitter = require('events');

const EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws';

class TwitchEventSub extends EventEmitter {
  constructor({ token, clientId, userId }) {
    super();
    this.token = token;
    this.clientId = clientId;
    this.userId = userId;
    this.ws = null;
    this.sessionId = null;
    this.keepaliveTimeout = null;
    this.shouldReconnect = true;
    this.subscriptions = new Set();
  }

  connect() {
    this.shouldReconnect = true;
    this.openSocket();
  }

  openSocket() {
    this.ws = new WebSocket(EVENTSUB_WS);

    this.ws.on('open', () => {
      this.emit('connected');
    });

    this.ws.on('message', (data) => this.onMessage(data));
    this.ws.on('close', () => this.onClose());
    this.ws.on('error', (err) => this.emit('error', err.message));
  }

  async onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const type = msg.metadata?.message_type;

    // Welcome — получаем sessionId
    if (type === 'session_welcome') {
      this.sessionId = msg.payload.session.id;
      this.emit('session', this.sessionId);
      this.resetKeepalive(msg.payload.session.keepalive_timeout_seconds || 30);
      // Подписываемся на нужные события
      await this.subscribeDefaults();
      return;
    }

    if (type === 'session_keepalive') {
      this.resetKeepalive(30);
      return;
    }

    if (type === 'session_reconnect') {
      // Twitch просит переподключиться на новый URL
      const newUrl = msg.payload.session.reconnect_url;
      if (newUrl) {
        this.ws.close();
        this.ws = new WebSocket(newUrl);
        this.ws.on('message', (d) => this.onMessage(d));
        this.ws.on('close', () => this.onClose());
        this.ws.on('error', (err) => this.emit('error', err.message));
      }
      return;
    }

    if (type === 'notification') {
      const subType = msg.metadata.subscription_type;
      this.emit('event', { type: subType, event: msg.payload.event });
    }

    if (type === 'revocation') {
      this.emit('revocation', msg.payload.subscription);
    }
  }

  resetKeepalive(seconds) {
    if (this.keepaliveTimeout) clearTimeout(this.keepaliveTimeout);
    this.keepaliveTimeout = setTimeout(() => {
      // Не получили keepalive — переподключаемся
      try { this.ws.close(); } catch {}
    }, (seconds + 10) * 1000);
  }

  async subscribeDefaults() {
    // Подписка на покупку наград за баллы
    await this.subscribe('channel.channel_points_custom_reward_redemption.add', '1', {
      broadcaster_user_id: this.userId,
    });
  }

  async subscribe(type, version, condition) {
    const key = `${type}:${JSON.stringify(condition)}`;
    if (this.subscriptions.has(key)) return;
    this.subscriptions.add(key);

    try {
      const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'POST',
        headers: {
          'Client-Id': this.clientId,
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type,
          version,
          condition,
          transport: { method: 'websocket', session_id: this.sessionId },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        this.emit('error', `Subscribe ${type} failed: ${res.status} ${text}`);
        this.subscriptions.delete(key);
      } else {
        this.emit('subscribed', type);
      }
    } catch (e) {
      this.emit('error', e.message);
      this.subscriptions.delete(key);
    }
  }

  onClose() {
    if (this.keepaliveTimeout) clearTimeout(this.keepaliveTimeout);
    this.emit('disconnected');
    if (this.shouldReconnect) {
      setTimeout(() => this.openSocket(), 3000);
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.keepaliveTimeout) clearTimeout(this.keepaliveTimeout);
    if (this.ws) { try { this.ws.close(); } catch {} }
  }
}

module.exports = { TwitchEventSub };