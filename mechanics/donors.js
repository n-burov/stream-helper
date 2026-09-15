// mechanics/donors.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  return {
    participants: d.donors?.participants || [],
    resetAt: d.donors?.resetAt || null,
  };
}

// Добавление доната (вызывается из donationalerts.js)
function addDonor({ name, amount, currency, message, at }) {
  const trimmed = String(name || 'Аноним').trim() || 'Аноним';
  const lower = trimmed.toLowerCase();
  const sum = Number(amount) || 0;

  const d = db.loadData();
  const existing = d.donors.participants.find(p => p.name.toLowerCase() === lower);

  if (existing) {
    // Обновляем существующего донатера — прибавляем сумму и увеличиваем счётчик
    db.update(dd => {
      const p = dd.donors.participants.find(x => x.name.toLowerCase() === lower);
      if (p) {
        p.totalAmount = (p.totalAmount || 0) + sum;
        p.count = (p.count || 1) + 1;
        p.lastAt = at || Date.now();
        if (message) p.lastMessage = message;
      }
    });
  } else {
    // Новый донатер — добавляем
    const entry = {
      name: trimmed,
      totalAmount: sum,
      currency: currency || 'RUB',
      count: 1,
      lastAt: at || Date.now(),
      lastMessage: message || '',
    };

    db.update(dd => {
      dd.donors.participants.push(entry);
    });
  }

  ctxRef.broadcast('donors:state', getState());
  return { ok: true };
}

// Ручное добавление
function addManual(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { error: 'Пустое имя' };

  const lower = trimmed.toLowerCase();
  const d = db.loadData();
  if (d.donors.participants.some(p => p.name.toLowerCase() === lower)) {
    return { error: 'Уже в списке' };
  }

  const entry = {
    name: trimmed,
    totalAmount: 0,
    currency: 'RUB',
    count: 0,
    lastAt: Date.now(),
    manual: true,
  };

  db.update(dd => {
    dd.donors.participants.push(entry);
  });

  ctxRef.broadcast('donors:state', getState());
  return { ok: true, entry };
}

function removeAt(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) return { error: 'Некорректный индекс' };

  db.update(d => {
    if (idx < d.donors.participants.length) d.donors.participants.splice(idx, 1);
  });

  ctxRef.broadcast('donors:state', getState());
  return { ok: true };
}

function reset() {
  const now = Date.now();
  db.update(d => {
    d.donors.participants = [];
    d.donors.resetAt = now;
  });
  ctxRef.broadcast('donors:state', getState());
  return { ok: true, resetAt: now };
}

function getUsernames() {
  const d = db.loadData();
  return (d.donors?.participants || []).map(p => p.name);
}

module.exports = { init, getState, addDonor, addManual, removeAt, reset, getUsernames };
