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

// Полная замена списка (вызывается из donatepay.js)
function replaceAll(participants) {
  db.update(d => {
    d.donors.participants = Array.isArray(participants) ? participants : [];
  });
  ctxRef.broadcast('donors:state', getState());
  return { ok: true };
}

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

  db.update(dd => { dd.donors.participants.push(entry); });
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

// Сброс: очищаем список И ставим resetAt — с этого момента все донаты "до" игнорируются
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

module.exports = { init, getState, replaceAll, addManual, removeAt, reset, getUsernames };
