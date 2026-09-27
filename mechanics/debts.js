// mechanics/debts.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  const list = (d.debts?.list || []).map(x => ({
    ...x,
    // Сразу посчитаем срок, чтобы UI не занимался арифметикой
    daysSince: Math.floor((Date.now() - x.createdAt) / (24 * 60 * 60 * 1000)),
  }));
  return { list };
}

// Добавить долг (или увеличить сумму, если ник уже есть)
function add({ username, amount }) {
  const trimmedName = String(username || '').trim();
  if (!trimmedName) return { error: 'Пустое имя' };
  const sum = Number(amount);
  if (!Number.isFinite(sum) || sum <= 0) return { error: 'Сумма должна быть > 0' };

  const lower = trimmedName.toLowerCase();
  let created = false;

  db.update(d => {
    if (!d.debts) d.debts = { list: [] };
    const existing = d.debts.list.find(x => x.username.toLowerCase() === lower);

    if (existing) {
      existing.amount = (Number(existing.amount) || 0) + sum;
      existing.updatedAt = Date.now();
    } else {
      d.debts.list.push({
        userId: 'manual_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        username: trimmedName,
        amount: sum,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      created = true;
    }
  });

  ctxRef.broadcast('debts:state', getState());
  return { ok: true, created };
}

// Ручная корректировка суммы (задать точное значение)
function setAmount(username, amount) {
  const lower = String(username || '').toLowerCase();
  const sum = Number(amount);
  if (!Number.isFinite(sum) || sum < 0) return { error: 'Некорректная сумма' };

  db.update(d => {
    const item = d.debts.list.find(x => x.username.toLowerCase() === lower);
    if (item) {
      item.amount = sum;
      item.updatedAt = Date.now();
    }
  });

  ctxRef.broadcast('debts:state', getState());
  return { ok: true };
}

// Удалить долг
function remove(username) {
  const lower = String(username || '').toLowerCase();
  db.update(d => {
    d.debts.list = d.debts.list.filter(x => x.username.toLowerCase() !== lower);
  });
  ctxRef.broadcast('debts:state', getState());
  return { ok: true };
}

// Полный сброс
function reset() {
  db.update(d => { d.debts = { list: [] }; });
  ctxRef.broadcast('debts:state', getState());
  return { ok: true };
}

// Для команды в чате
function findByUserId(userId) {
  const d = db.loadData();
  return d.debts.list.find(x => x.userId === userId) || null;
}

// Обработка чат-команды !долг
function handleChat(msg) {
  const text = msg.message.trim().toLowerCase();
  if (text !== '!долг' && text !== '!долги' && text !== '!debt') return;

  // Опционально: антиспам — не отвечать чаще раза в 30 секунд одному пользователю
  if (isRateLimited(msg.userId)) return;

  const debt = findByUserId(msg.userId);
  if (!debt) {
    // Раскомментируй, если хочешь ответ для тех, у кого долгов нет
    // if (ctxRef.twitch) {
    //   ctxRef.twitch.sendMessage(`@${msg.username}, у тебя нет долгов`).catch(() => {});
    // }
    return;
  }

  const days = Math.floor((Date.now() - debt.createdAt) / (24 * 60 * 60 * 1000));
  const date = new Date(debt.createdAt).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  const text2 = `@${msg.username}, твой долг: ${debt.amount.toLocaleString('ru-RU')} голды. Срок: ${days} ${pluralDays(days)} (с ${date})`;

  if (ctxRef.twitch) {
    ctxRef.twitch.sendMessage(text2).catch(e => {
      console.warn('[debts] ошибка отправки в чат:', e.message);
    });
  }
}

// Простой антиспам — не чаще раза в 30 секунд одному userId
const lastAnswer = new Map();
function isRateLimited(userId) {
  const now = Date.now();
  const last = lastAnswer.get(userId) || 0;
  if (now - last < 30_000) return true;
  lastAnswer.set(userId, now);
  return false;
}

function pluralDays(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}

module.exports = {
  init, getState, add, setAmount, remove, reset,
  handleChat, findByUserId,
};
