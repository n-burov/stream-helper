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

    // Список ID созданных подписок (для возможной очистки)
    this.subscriptionIds = [];

    // Флаг: мы в процессе "официального" реконнекта по reconnect_url?
    // Если да — НЕ создаём подписки заново.
    this.isReconnectingViaUrl = false;

    // Ссылка на старый сокет во время реконнекта
    this.oldWs = null;
  }

  connect() {
    this.shouldReconnect = true;
    this.openSocket(EVENTSUB_WS);
  }

  /**
   * Открыть WebSocket.
   * @param {string} url — либо базовый, либо reconnect_url от Twitch
   */
  openSocket(url) {
    // Если это реконнект по URL — не пересоздаём подписки
    const isUrlReconnect = url !== EVENTSUB_WS;
    if (isUrlReconnect) {
      this.isReconnectingViaUrl = true;
      console.log('[eventsub] Официальный реконнект по reconnect_url...');
    } else {
      this.isReconnectingViaUrl = false;
    }

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      // Не эмитим 'connected' здесь — ждём session_welcome
    });

    this.ws.on('message', (data) => this.onMessage(data));

    this.ws.on('close', (code, reason) => this.onClose(code, reason));

    this.ws.on('error', (err) => {
      this.emit('error', 'WS: ' + err.message);
    });
  }

  async onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const meta = msg.metadata || {};
    const type = meta.message_type;

    // === SESSION WELCOME ===
    if (type === 'session_welcome') {
      const newSessionId = msg.payload.session.id;
      const reconnectUrl = msg.payload.session.reconnect_url;

      console.log('[eventsub] Session Welcome. ID:', newSessionId);

      // Если мы в процессе официального реконнекта — старый сокет можно закрывать
      if (this.isReconnectingViaUrl && this.oldWs) {
        console.log('[eventsub] Welcome получен на новом сокете, закрываю старый...');
        try { this.oldWs.close(); } catch {}
        this.oldWs = null;
        this.isReconnectingViaUrl = false;
      }

      this.sessionId = newSessionId;
      this.resetKeepalive(msg.payload.session.keepalive_timeout_seconds || 30);

      // ВАЖНО: создаём подписки только если это НЕ официальный реконнект.
      // При reconnect_url подписки уже перенесены автоматически.
      if (!this.isReconnectingViaUrl) {
        await this.subscribeDefaults();
      } else {
        console.log('[eventsub] Подписки перенесены автоматически, пропускаю создание.');
      }

      this.emit('connected');
      return;
    }

    // === SESSION KEEPALIVE ===
    if (type === 'session_keepalive') {
      this.resetKeepalive(30);
      return;
    }

    // === SESSION RECONNECT ===
    if (type === 'session_reconnect') {
      const newUrl = msg.payload.session.reconnect_url;

      if (!newUrl) {
        console.warn('[eventsub] Получен session_reconnect без reconnect_url!');
        return;
      }

      console.log('[eventsub] Получен session_reconnect. Переключаюсь на новый URL...');

      // Сохраняем ссылку на старый сокет — закроем его только после Welcome
      this.oldWs = this.ws;

      // Открываем новый сокет по официальному URL
      this.openSocket(newUrl);
      return;
    }

    // === NOTIFICATION ===
    if (type === 'notification') {
      const subType = meta.subscription_type;
      this.emit('event', { type: subType, event: msg.payload.event });
      return;
    }

    // === REVOCATION ===
    if (type === 'revocation') {
      this.emit('revocation', msg.payload.subscription);
    }
  }

  resetKeepalive(seconds) {
    if (this.keepaliveTimeout) clearTimeout(this.keepaliveTimeout);
    // Twitch обычно шлёт keepalive каждые 10 сек. Даём запас.
    this.keepaliveTimeout = setTimeout(() => {
      console.warn('[eventsub] Keepalive таймаут, переподключение...');
      try { this.ws.close(); } catch {}
    }, (seconds + 15) * 1000);
  }

  /**
   * Создание подписок "по умолчанию".
   * Вызывается ТОЛЬКО при обычном подключении (не при reconnect_url).
   */
  async subscribeDefaults() {
    // ВАЖНО: сначала очищаем старые подписки, которые могли остаться от предыдущей сессии.
    // Это критично, чтобы не упереться в лимит max_total_cost.
    await this.cleanupStaleSubscriptions();

    // Покупка наград за баллы
    await this.subscribe('channel.channel_points_custom_reward_redemption.add', '1', {
      broadcaster_user_id: this.userId,
    });

    // Стрим завершён
    await this.subscribe('stream.offline', '1', {
      broadcaster_user_id: this.userId,
    });

    // Стрим начался
    await this.subscribe('stream.online', '1', {
      broadcaster_user_id: this.userId,
    });
  }

  /**
   * Удалить подписки, которые относятся к нашим сессиям,
   * но уже неактивны (например, после креша).
   * Это освобождает лимит max_total_cost.
   */
  async cleanupStaleSubscriptions() {
    try {
      const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        headers: {
          'Client-Id': this.clientId,
          'Authorization': `Bearer ${this.token}`,
        },
      });

      if (!res.ok) return;
      const data = await res.json();
      const subs = data.data || [];

      // Ищем подписки того же типа, что мы будем создавать,
      // и у которых transport method = websocket (наш случай).
      const ourTypes = [
        'channel.channel_points_custom_reward_redemption.add',
        'stream.offline',
        'stream.online',
      ];

      for (const sub of subs) {
        if (!ourTypes.includes(sub.type)) continue;
        if (sub.transport?.method !== 'websocket') continue;
        // Если session_id отличается от текущего — это "сирота"
        if (sub.transport.session_id && sub.transport.session_id !== this.sessionId) {
          console.log('[eventsub] Удаляю устаревшую подписку:', sub.id, sub.type);
          await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${sub.id}`, {
            method: 'DELETE',
            headers: {
              'Client-Id': this.clientId,
              'Authorization': `Bearer ${this.token}`,
            },
          });
        }
      }
    } catch (e) {
      // Не критично, просто логируем
      console.warn('[eventsub] Ошибка очистки подписок:', e.message);
    }
  }

  async subscribe(type, version, condition) {
    const key = `${type}:${JSON.stringify(condition)}`;

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
        return null;
      }

      const data = await res.json();
      const subId = data.data?.[0]?.id;
      if (subId) {
        this.subscriptionIds.push(subId);
        this.emit('subscribed', type);
      }
      return subId;
    } catch (e) {
      this.emit('error', e.message);
      return null;
    }
  }

  onClose(code, reason) {
    if (this.keepaliveTimeout) clearTimeout(this.keepaliveTimeout);

    const reasonStr = reason?.toString() || '';

    // Логируем код закрытия — это ключ к пониманию проблем
    console.log(`[eventsub] WebSocket закрыт. Код: ${code}, Причина: "${reasonStr}"`);

    // Расшифровка типовых кодов
    if (code === 4001) console.warn('[eventsub] 4001: Client sent inbound traffic');
    if (code === 4002) console.warn('[eventsub] 4002: Client failed ping-pong');
    if (code === 4003) console.warn('[eventsub] 4003: Connection unused (не создали подписки вовремя)');
    if (code === 4004) console.warn('[eventsub] 4004: Reconnect grace time expired');
    if (code === 4007) console.warn('[eventsub] 4007: Invalid reconnect');

    this.emit('disconnected', { code, reason: reasonStr });

    // Если это был официальный реконнект и мы не успели — пробуем снова с базовым URL
    if (this.isReconnectingViaUrl) {
      console.warn('[eventsub] Официальный реконнект провалился, возвращаюсь к базовому URL');
      this.isReconnectingViaUrl = false;
    }

    if (this.shouldReconnect) {
      setTimeout(() => {
        if (this.shouldReconnect) this.openSocket(EVENTSUB_WS);
      }, 5000);
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.keepaliveTimeout) clearTimeout(this.keepaliveTimeout);
    if (this.oldWs) { try { this.oldWs.close(); } catch {} }
    if (this.ws) { try { this.ws.close(); } catch {} }
  }
}

module.exports = { TwitchEventSub };
