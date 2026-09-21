// mechanics/donors.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  return {
    stream: d.donors?.stream?.participants || [],
    weekly: d.donors?.weekly?.participants || [],
    weeklyResetAt: d.donors?.weekly?.lastResetAt || null,
  };
}

function broadcastAll() {
  ctxRef.broadcast('donors:state', getState());
}

// Проверка недельного сброса
function checkWeeklyReset() {
  const d = db.loadData();
  const last = d.donors?.weekly?.lastResetAt || 0;

  const now = new Date();
  const day = now.getDay(); // 0 = вс, 1 = пн, ..., 6 = сб
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  const mondayTs = monday.getTime();

  if (last < mondayTs) {
    db.update(dd => {
      dd.donors.weekly.participants = [];
      dd.donors.weekly.lastResetAt = Date.now();
    });
    broadcastAll();
    return true;
  }
  return false;
}

// Добавление донатера в оба списка
function addDonor({ name, amount, currency, message, at }) {
  const trimmed = String(name || 'Аноним').trim() || 'Аноним';
  const sum = Number(amount) || 0;
  const ts = at || Date.now();

  db.update(d => {
    if (!d.donors) d.donors = {};
    if (!d.donors.stream) d.donors.stream = { participants: [] };
    if (!d.donors.weekly) d.donors.weekly = { participants: [], lastResetAt: null };

    addTo(d.donors.stream.participants, trimmed, sum, currency, message, ts);
    addTo(d.donors.weekly.participants, trimmed, sum, currency, message, ts);
  });

  broadcastAll();
  return { ok: true };
}

function addTo(list, name, amount, currency, message, ts) {
  const lower = name.toLowerCase();
  const existing = list.find(p => p.name.toLowerCase() === lower);

  if (existing) {
    existing.totalAmount = (existing.totalAmount || 0) + amount;
    existing.count = (existing.count || 1) + 1;
    existing.lastAt = ts;
    if (message) existing.lastMessage = message;
    if (currency) existing.currency = currency;
  } else {
    list.push({
      name,
      totalAmount: amount,
      currency: currency || 'RUB',
      count: 1,
      lastAt: ts,
      lastMessage: message || '',
    });
  }
}

function addManual(listName, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { error: 'Пустое имя' };
  if (listName !== 'stream' && listName !== 'weekly') return { error: 'Неверный список' };

  const lower = trimmed.toLowerCase();
  const d = db.loadData();
  const list = d.donors[listName].participants;

  if (list.some(p => p.name.toLowerCase() === lower)) {
    return { error: 'Уже в списке' };
  }

  db.update(dd => {
    dd.donors[listName].participants.push({
      name: trimmed,
      totalAmount: 0,
      currency: 'RUB',
      count: 0,
      lastAt: Date.now(),
      manual: true,
    });
  });

  broadcastAll();
  return { ok: true };
}

function removeAt(listName, index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) return { error: 'Некорректный индекс' };
  if (listName !== 'stream' && listName !== 'weekly') return { error: 'Неверный список' };

  db.update(d => {
    if (idx < d.donors[listName].participants.length) {
      d.donors[listName].participants.splice(idx, 1);
    }
  });

  broadcastAll();
  return { ok: true };
}

function reset(listName) {
  if (listName !== 'stream' && listName !== 'weekly') return { error: 'Неверный список' };

  db.update(d => {
    d.donors[listName].participants = [];
    if (listName === 'weekly') {
      d.donors.weekly.lastResetAt = Date.now();
    }
  });

  broadcastAll();
  return { ok: true };
}

module.exports = { init, getState, addDonor, addManual, removeAt, reset, checkWeeklyReset };
