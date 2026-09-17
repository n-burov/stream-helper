// mechanics/announcements.js
const db = require('../db');

let ctxRef = null;
let timer = null;

function init(ctx) {
  ctxRef = ctx;
  restartTimer();
}

function getState() {
  const d = db.loadData();
  return d.announcements || {
    enabled: false,
    intervalMin: 10,
    messagesGapMs: 1500,
    list: [],
  };
}

function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function restartTimer() {
  stopTimer();
  const state = getState();
  if (!state.enabled) return;

  const intervalMs = Math.max(1, state.intervalMin) * 60 * 1000;
  timer = setInterval(() => {
    sendNext().catch(e => console.warn('[announce] ошибка:', e.message));
  }, intervalMs);

  console.log(`[announce] таймер перезапущен: интервал ${state.intervalMin} мин`);
}

// Отправить одно сообщение (с учётом типа)
async function sendOne(msg, gapMs) {
  if (!msg || !msg.text) return;

  try {
    if (!ctxRef.twitch) {
      console.warn('[announce] twitch не подключён, пропуск');
      return;
    }

    if (msg.type === 'announce') {
      await ctxRef.twitch.sendAnnounce(msg.text, msg.color || 'primary');
      console.log(`[announce] ANNOUNCE: ${msg.text.slice(0, 60)}`);
    } else {
      await ctxRef.twitch.sendMessage(msg.text);
      console.log(`[announce] MESSAGE: ${msg.text.slice(0, 60)}`);
    }
  } catch (e) {
    console.warn('[announce] ошибка отправки:', e.message);
  }
}

async function sendNext() {
  const state = getState();
  if (!state.enabled) return { skipped: true };

  const list = state.list || [];
  const enabledIdx = list.findIndex(a => a.enabled);
  if (enabledIdx === -1) return { error: 'Нет включённых анонсов' };

  const announcement = list[enabledIdx];

  for (let i = 0; i < announcement.messages.length; i++) {
    await sendOne(announcement.messages[i]);
    if (i < announcement.messages.length - 1) {
      await new Promise(r => setTimeout(r, state.messagesGapMs || 1500));
    }
  }

  // Ротация
  db.update(d => {
    if (!d.announcements) return;
    const arr = d.announcements.list || [];
    const idx = arr.findIndex(a => a.id === announcement.id);
    if (idx !== -1) {
      const [item] = arr.splice(idx, 1);
      arr.push(item);
    }
  });

  ctxRef.broadcast('announcements:state', getState());
  return { ok: true, sent: announcement.title };
}

async function sendNow(id) {
  const state = getState();
  const announcement = (state.list || []).find(a => a.id === id);
  if (!announcement) return { error: 'Анонс не найден' };
  if (!announcement.messages || announcement.messages.length === 0) return { error: 'Нет сообщений' };

  for (let i = 0; i < announcement.messages.length; i++) {
    await sendOne(announcement.messages[i]);
    if (i < announcement.messages.length - 1) {
      await new Promise(r => setTimeout(r, state.messagesGapMs || 1500));
    }
  }

  return { ok: true, sent: announcement.title };
}

// === CRUD (без изменений) ===
function addAnnouncement({ title, messages, enabled }) {
  const t = String(title || '').trim() || 'Без названия';
  const msgs = Array.isArray(messages)
    ? messages.map(m => {
        if (typeof m === 'string') return { type: 'message', text: m.trim() };
        if (m && typeof m === 'object' && m.text) return { type: m.type === 'announce' ? 'announce' : 'message', text: String(m.text).trim(), color: m.color };
        return null;
      }).filter(m => m && m.text)
    : [];
  if (msgs.length === 0) return { error: 'Добавь хотя бы одно сообщение' };

  const id = 'a_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

  db.update(d => {
    if (!d.announcements) d.announcements = { enabled: false, intervalMin: 10, messagesGapMs: 1500, list: [] };
    d.announcements.list.push({ id, title: t, enabled: enabled !== false, messages: msgs });
  });

  ctxRef.broadcast('announcements:state', getState());
  return { ok: true, id };
}

function updateAnnouncement(id, patch) {
  db.update(d => {
    if (!d.announcements) return;
    const a = d.announcements.list.find(x => x.id === id);
    if (!a) return;
    if (typeof patch.title === 'string') a.title = patch.title.trim() || a.title;
    if (typeof patch.enabled === 'boolean') a.enabled = patch.enabled;
    if (Array.isArray(patch.messages)) {
      a.messages = patch.messages.map(m => {
        if (typeof m === 'string') return { type: 'message', text: m.trim() };
        if (m && typeof m === 'object' && m.text) return { type: m.type === 'announce' ? 'announce' : 'message', text: String(m.text).trim(), color: m.color };
        return null;
      }).filter(m => m && m.text);
    }
  });
  ctxRef.broadcast('announcements:state', getState());
  return { ok: true };
}

function removeAnnouncement(id) {
  db.update(d => {
    if (!d.announcements) return;
    d.announcements.list = d.announcements.list.filter(a => a.id !== id);
  });
  ctxRef.broadcast('announcements:state', getState());
  return { ok: true };
}

function setEnabled(enabled) {
  db.update(d => {
    if (!d.announcements) d.announcements = { enabled: false, intervalMin: 10, messagesGapMs: 1500, list: [] };
    d.announcements.enabled = !!enabled;
  });
  restartTimer();
  ctxRef.broadcast('announcements:state', getState());
  return { ok: true };
}

function setIntervalMin(min) {
  const n = Math.max(1, parseInt(min) || 10);
  db.update(d => { if (d.announcements) d.announcements.intervalMin = n; });
  restartTimer();
  ctxRef.broadcast('announcements:state', getState());
  return { ok: true };
}

function setMessagesGapMs(ms) {
  const n = Math.max(500, parseInt(ms) || 1500);
  db.update(d => { if (d.announcements) d.announcements.messagesGapMs = n; });
  ctxRef.broadcast('announcements:state', getState());
  return { ok: true };
}

module.exports = {
  init, getState, sendNext, sendNow,
  addAnnouncement, updateAnnouncement, removeAnnouncement,
  setEnabled, setIntervalMin, setMessagesGapMs,
  restartTimer,
};
