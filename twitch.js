// twitch.js
const tmi = require('tmi.js');
const EventEmitter = require('events');
const { sendAnnouncement } = require('./twitch-api');

class TwitchService extends EventEmitter {
  constructor({ username, token, channel, userId, clientId }) {
    super();

    this.channel = channel;
    this.username = username;
    this.accessToken = token;
    this.userId = userId || null;
    this.clientId = clientId || null;

    this.client = new tmi.Client({
      options: { debug: false },
      identity: {
        username: username,
        password: token.startsWith('oauth:') ? token : `oauth:${token}`,
      },
      channels: [channel],
    });

    this.client.on('message', (channel, tags, message, self) => {
      if (self) return;
      this.emit('chat', {
        userId: tags['user-id'],
        username: tags['display-name'] || tags.username,
        message,
        isMod: tags.mod === true,
        isVip: tags.badges?.vip === '1',
        isSubscriber: tags.subscriber === true,
        isBroadcaster: tags.badges?.broadcaster === '1',
        color: tags.color || '#ffffff',
        timestamp: Date.now(),
      });
    });

    this.client.on('connected', () => this.emit('connected'));
    this.client.on('disconnected', (r) => this.emit('disconnected', r));
  }

  async connect() {
    await this.client.connect();
  }

  async disconnect() {
    try { await this.client.disconnect(); } catch {}
  }

  // Обычное сообщение в чат (через IRC)
  async sendMessage(text) {
    const safe = String(text || '').slice(0, 500);
    return this.client.say(this.channel, safe);
  }

  // Выделенный анонс через Helix API.
  // Требует scope: moderator:manage:announcements
  // Требует: userId и clientId (передаются в конструктор из server.js)
  async sendAnnounce(text, color = 'primary') {
    if (!this.userId || !this.clientId) {
      console.warn('[twitch] sendAnnounce: нет userId/clientId — команда пропущена');
      return;
    }

    const validColors = ['primary', 'blue', 'green', 'orange', 'purple'];
    const c = validColors.includes(color) ? color : 'primary';

    try {
      // broadcaster_id = канал, moderator_id = тот, кто отправляет (у нас — сам стример)
      return await sendAnnouncement({
        token: this.accessToken,
        clientId: this.clientId,
        broadcasterId: this.userId,
        moderatorId: this.userId,
        message: text,
        color: c,
      });
    } catch (e) {
      console.warn('[twitch] sendAnnounce error:', e.message);
      throw e;
    }
  }
}

module.exports = { TwitchService };
