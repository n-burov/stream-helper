// mechanics/donors.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  const participants = (d.donors?.participants || []).map(p => ({
    name: p.name,
    totalAmount: typeof p.totalAmount === 'number' ? p.totalAmount : (Number(p.amount) || 0),
    currency: p.currency || 'RUB',
    count: typeof p.count === 'number' ? p.count : 1,
    lastAt: p.lastAt || p.at || Date.now(),
  }));
  return { participants };
}

// Ищем донатера без учёта регистра
function findDonor(list, name) {
  const lower = String(name).trim().toLowerCase();
  return list.find(p => String(p.name).trim().toLowerCase() === lower);
}

function addDonor({ name, amount, currency, message, at }) {
  const trimmed = String(name || '').trim() || 'Аноним';
  const sum = Number(amount) || 0;

  const d = db.loadData();
  const existing = findDonor(d.donors.participants, trimmed);

  if (existing) {
    // Уже в списке — увеличиваем сумму и счётчик, но НЕ добавляем вторую запись
    db.update(dd => {
      const p = findDonor(dd.donors.participants, trimmed);
      if (p) {
        p.totalAmount = (p.totalAmount || 0) + sum;
        p.count = (p.count || 1) + 1;
        p.lastAt = at || Date.now();
      }
    });
    ctxRef.broadcast('donors:state', getState());
    return { ok: true, updated: true };
  }

  const entry = {
    name: trimmed,
    totalAmount: sum,
    currency: currency || 'RUB',
    count: 1,
    lastAt: at || Date.now(),
    message: message || '',
  };

  db.update(dd => { dd.donors.participants.push(entry); });
  ctxRef.broadcast('donors:state', getState());
  return { ok: true, entry };
}

function addManual(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { error: 'Пустое имя' };
  return addDonor({ name: trimmed, amount: 0 });
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
  db.update(d => { d.donors.participants = []; });
  ctxRef.broadcast('donors:state', getState());
  return { ok: true };
}

function getUsernames() {
  const d = db.loadData();
  return (d.donors?.participants || []).map(p => p.name);
}

module.exports = { init, getState, addDonor, addManual, removeAt, reset, getUsernames };
