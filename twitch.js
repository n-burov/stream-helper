// twitch.js
const tmi = require('tmi.js');
const EventEmitter = require('events');

class TwitchService extends EventEmitter {
  constructor({ username, token, channel }) {
    super();
    this.channel = channel;
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

  async sendMessage(text) {
    return this.client.say(this.channel, text);
  }
}

module.exports = { TwitchService };