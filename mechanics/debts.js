// mechanics/debts.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  const list = (d.debts?.list || []).map(x => ({
    ...x,
    daysSince: Math.floor((Date.now() - x.createdAt) / (24 * 60 * 60 * 1000)),
  }));
  return { list };
}

// Нормализация ника — для поиска без учёта регистра
function normalize(name) {
  return String(name || '').trim().toLowerCase();
}

// Убираем ведущую @ у ника, если её кто-то напишет
function cleanNick(name) {
  return String(name || '').trim().replace(/^@+/, '');
}

// Добавить долг (или увеличить сумму, если ник уже есть)
function add({ username, amount }) {
  const trimmedName = cleanNick(username);
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

// Ручная корректировка суммы
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

function say(text) {
  if (!ctxRef?.twitch) {
    console.warn('[debts] twitch НЕ подключён, пропуск:', text);
    return;
  }
  console.log('[debts] отправляю в чат:', text);
  ctxRef.twitch.sendMessage(text).catch(e => {
    console.warn('[debts] ошибка отправки в чат:', e.message);
  });
}

function handleChat(msg) {
  console.log('[debts] === handleChat вызван ===');
  console.log('[debts] msg:', JSON.stringify({
    username: msg?.username,
    message: msg?.message,
    userId: msg?.userId,
  }));

  const raw = String(msg.message || '').trim();
  console.log('[debts] raw:', JSON.stringify(raw));

  const match = raw.match(/^!(долг|долги|debt)(?:\s+(.+))?$/i);
  console.log('[debts] match:', match);

  if (!match) return;

  if (isRateLimited(msg.username)) {
    console.log('[debts] rate limited для', msg.username);
    return;
  }

  console.log('[debts] ctxRef:', !!ctxRef, 'twitch:', !!ctxRef?.twitch);

  const argRaw = (match[2] || '').trim();
  console.log('[debts] argRaw:', JSON.stringify(argRaw));

  if (!argRaw) {
    const debt = findByUsername(msg.username);
    console.log('[debts] свой долг:', debt);

    if (!debt) {
      say(`@${msg.username}, у тебя нет долгов 🎉`);
      return;
    }

    say(formatDebtReply(msg.username, debt));
    return;
  }

  const targetRaw = argRaw.split(/[\s,]+/)[0];
  const target = cleanNick(targetRaw);
  console.log('[debts] target:', JSON.stringify(target));

  if (!target) {
    say(`@${msg.username}, укажи ник: !долг ник`);
    return;
  }

  const debt = findByUsername(target);
  console.log('[debts] долг target:', debt);

  if (!debt) {
    say(`@${msg.username}, у @${target} нет долгов`);
    return;
  }

  say(`@${msg.username}, долг @${debt.username}: ${formatDebtBody(debt)}`);
}

// Форматирование ответа про свой долг
function formatDebtReply(asker, debt) {
  return `@${asker}, твой долг: ${formatDebtBody(debt)}`;
}

// Тело ответа (сумма + срок + дата)
function formatDebtBody(debt) {
  const days = Math.floor((Date.now() - debt.createdAt) / (24 * 60 * 60 * 1000));
  const date = new Date(debt.createdAt).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const amount = Number(debt.amount || 0).toLocaleString('ru-RU');
  return `${amount} голды. Срок: ${days} ${pluralDays(days)} (с ${date})`;
}

// Антиспам — не чаще раза в 30 секунд на один ник того, кто пишет
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
