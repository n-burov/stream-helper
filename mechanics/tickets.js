// mechanics/tickets.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  // Нормализуем: у каждого участника есть count (по умолчанию 1)
  const participants = (d.tickets?.participants || []).map(p => ({
    userId: p.userId,
    username: p.username,
    count: typeof p.count === 'number' ? p.count : 1,
    redeemedAt: p.redeemedAt,
  }));
  return { participants };
}

// Вызывается из EventSub при покупке награды
function addFromRedemption({ userId, username, rewardId, redeemedAt }) {
  const d = db.loadData();

  if (d.settings.ticketRewardId && rewardId !== d.settings.ticketRewardId) {
    return { skipped: true };
  }

  // Если уже есть — не добавляем (один билет на неделю)
  if (d.tickets.participants.some(p => p.userId === userId)) {
    return { duplicate: true };
  }

  const entry = {
    userId,
    username,
    count: 1,
    redeemedAt: redeemedAt || Date.now(),
  };

  db.update(dd => { dd.tickets.participants.push(entry); });
  ctxRef.broadcast('tickets:state', getState());
  return { ok: true, entry };
}

function addManual(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { error: 'Пустое имя' };

  const lower = trimmed.toLowerCase();
  const d = db.loadData();
  if (d.tickets.participants.some(p => p.username.toLowerCase() === lower)) {
    return { error: 'Уже в списке' };
  }

  const entry = {
    userId: 'manual_' + Date.now(),
    username: trimmed,
    count: 1,
    redeemedAt: Date.now(),
  };

  db.update(dd => { dd.tickets.participants.push(entry); });
  ctxRef.broadcast('tickets:state', getState());
  return { ok: true, entry };
}

function removeByName(username) {
  db.update(d => {
    d.tickets.participants = d.tickets.participants.filter(
      p => p.username.toLowerCase() !== String(username).toLowerCase()
    );
  });
  ctxRef.broadcast('tickets:state', getState());
  return { ok: true };
}

// Изменить количество билетов у участника (для ручной передачи)
function setCount(username, count) {
  const n = Math.max(0, parseInt(count) || 0);
  db.update(d => {
    const p = d.tickets.participants.find(
      x => x.username.toLowerCase() === String(username).toLowerCase()
    );
    if (!p) return;
    if (n === 0) {
      d.tickets.participants = d.tickets.participants.filter(
        x => x.username.toLowerCase() !== String(username).toLowerCase()
      );
    } else {
      p.count = n;
    }
  });
  ctxRef.broadcast('tickets:state', getState());
  return { ok: true };
}

function reset() {
  db.update(d => { d.tickets.participants = []; });
  ctxRef.broadcast('tickets:state', getState());
  return { ok: true };
}

// Экспорт чистого массива никнеймов для импорта в снайпер
function getUsernames() {
  const d = db.loadData();
  return (d.tickets?.participants || []).map(p => p.username);
}

module.exports = {
  init, getState, addFromRedemption, addManual,
  removeByName, setCount, reset, getUsernames,
};