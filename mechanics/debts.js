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

// Нормализация ника — для поиска без учёта регистра
function normalize(name) {
  return String(name || '').trim().toLowerCase();
}

// Добавить долг (или увеличить сумму, если ник уже есть)
function add({ username, amount }) {
  const trimmedName = String(username || '').trim();
  if (!trimmedName) return { error: 'Пустое имя' };

  const sum = Number(amount);
  if (!Number.isFinite(sum) || sum <= 0) return { error: 'Сумма должна быть > 0' };

  const lower = normalize(trimmedName);
  let created = false;

  db.update(d => {
    if (!d.debts) d.debts = { list: [] };

    const existing = d.debts.list.find(x => normalize(x.username) === lower);

    if (existing) {
      existing.amount = (Number(existing.amount) || 0) + sum;
      existing.updatedAt = Date.now();
    } else {
      d.debts.list.push({
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
  const lower = normalize(username);
  const sum = Number(amount);
  if (!Number.isFinite(sum) || sum < 0) return { error: 'Некорректная сумма' };

  db.update(d => {
    const item = (d.debts?.list || []).find(x => normalize(x.username) === lower);
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
  const lower = normalize(username);
  db.update(d => {
    if (!d.debts?.list) return;
    d.debts.list = d.debts.list.filter(x => normalize(x.username) !== lower);
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

// Найти долг по нику
function findByUsername(username) {
  const d = db.loadData();
  const lower = normalize(username);
  return (d.debts?.list || []).find(x => normalize(x.username) === lower) || null;
}

// Обработка чат-команды !долг
function handleChat(msg) {
  const text = String(msg.message || '').trim().toLowerCase();
  if (text !== '!долг' && text !== '!долги' && text !== '!debt') return;

  // Антиспам — не чаще раза в 30 секунд на один ник
  if (isRateLimited(msg.username)) return;

  const debt = findByUsername(msg.username);
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

  const reply = `@${msg.username}, твой долг: ${debt.amount.toLocaleString('ru-RU')} голды. Срок: ${days} ${pluralDays(days)} (с ${date})`;

  if (ctxRef.twitch) {
    ctxRef.twitch.sendMessage(reply).catch(e => {
      console.warn('[debts] ошибка отправки в чат:', e.message);
    });
  }
}

// Простой антиспам — не чаще раза в 30 секунд на один ник
const lastAnswer = new Map();
function isRateLimited(username) {
  const key = normalize(username);
  if (!key) return false;

  const now = Date.now();
  const last = lastAnswer.get(key) || 0;
  if (now - last < 30_000) return true;

  lastAnswer.set(key, now);
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
  handleChat, findByUsername,
};
