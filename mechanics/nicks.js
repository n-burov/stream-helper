// mechanics/nicks.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  return { nicks: d.nicks || {} };
}

// Обработка сообщений из чата
function handleChat(msg) {
  const text = msg.message.trim();
  if (!text.toLowerCase().startsWith('!ник')) return;

  const afterCmd = text.slice(4);
  if (afterCmd.length > 0 && !afterCmd.startsWith(' ')) return;

  const nickRaw = afterCmd.trim();
  const existing = db.loadData().nicks?.[msg.userId];

  // Если ник не указан
  if (!nickRaw) {
    if (ctxRef.twitch) {
      if (existing && existing.nick) {
        // Показываем текущие ники
        ctxRef.twitch.sendMessage(
          `@${msg.username}, твои ники: ${existing.nick}`
        ).catch(() => {});
      } else {
        // Подсказка
        ctxRef.twitch.sendMessage(
          `@${msg.username}, укажи ник: !ник <твой игровой ник>`
        ).catch(() => {});
      }
    }
    return;
  }

  // Ограничим длину, чтобы не спамили
  const nick = nickRaw.slice(0, 100);
  const isUpdate = !!(existing && existing.nick);

  const entry = {
    userId: msg.userId,
    twitchUsername: msg.username,
    nick: nick,
    updatedAt: Date.now(),
  };

  db.update(d => {
    if (!d.nicks) d.nicks = {};
    d.nicks[msg.userId] = entry;
  });

  ctxRef.broadcast('nicks:state', getState());
  ctxRef.broadcast('nicks:updated', entry);

  // Уведомление в чат
  if (ctxRef.twitch) {
    const prefix = isUpdate ? 'обновлён' : 'сохранён';
    ctxRef.twitch.sendMessage(
      `@${msg.username}, твой ник ${prefix}: ${nick}`
    ).catch(() => {});
  }

  console.log(`[nicks] ${isUpdate ? 'Обновлён' : 'Сохранён'} ник: ${msg.username} → ${nick}`);
}

// Ручное добавление из панели
function addManual(twitchUsername, nick) {
  const tw = String(twitchUsername || '').trim();
  const nk = String(nick || '').trim();

  if (!tw) return { error: 'Укажи Twitch-юзернейм' };
  if (!nk) return { error: 'Укажи ник' };

  const d = db.loadData();
  const existing = Object.values(d.nicks || {}).find(
    x => x.twitchUsername.toLowerCase() === tw.toLowerCase()
  );

  const userId = existing ? existing.userId : ('manual_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));

  const entry = {
    userId,
    twitchUsername: tw,
    nick: nk.slice(0, 100),
    updatedAt: Date.now(),
    manual: true,
  };

  db.update(dd => {
    if (!dd.nicks) dd.nicks = {};
    dd.nicks[userId] = entry;
  });

  ctxRef.broadcast('nicks:state', getState());
  return { ok: true, entry };
}

function remove(userId) {
  db.update(d => {
    if (d.nicks) delete d.nicks[userId];
  });
  ctxRef.broadcast('nicks:state', getState());
  return { ok: true };
}

function reset() {
  db.update(d => { d.nicks = {}; });
  ctxRef.broadcast('nicks:state', getState());
  return { ok: true };
}

module.exports = { init, getState, handleChat, addManual, remove, reset };
