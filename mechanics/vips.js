// mechanics/vips.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

const VIP_DURATION_DAYS = 30;
const VIP_DURATION_MS = VIP_DURATION_DAYS * 24 * 60 * 60 * 1000;

// ============================================================
//  Утилиты
// ============================================================

// Считаем оставшиеся дни (может быть отрицательным, если истёк)
function daysLeft(expiresAt) {
  return Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
}

// Нормализуем запись для UI
function normalizeEntry(v) {
  return {
    userId: v.userId || null,
    username: v.username,
    grantedAt: v.grantedAt || null,
    expiresAt: v.expiresAt || null,
    daysLeft: v.expiresAt ? daysLeft(v.expiresAt) : 0,
    lastSource: v.lastSource || null,
    manual: v.manual === true,
  };
}

// ============================================================
//  Состояние для UI
// ============================================================
function getState() {
  const d = db.loadData();
  const list = (d.vips?.list || [])
    .map(normalizeEntry)
    .sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0));
  return { list };
}

function broadcast() {
  if (ctxRef) ctxRef.broadcast('vips:state', getState());
}

// ============================================================
//  Работа с Twitch API (ленивый require, чтобы не ломать загрузку)
// ============================================================
function getTwitchApi() {
  try {
    return require('../twitch-api');
  } catch (e) {
    console.warn('[vips] не удалось загрузить twitch-api:', e.message);
    return null;
  }
}

function getTwitchContext() {
  const d = db.loadData();
  if (!d.tokens?.access_token || !d.tokens?.user_id) return null;
  return {
    token: d.tokens.access_token,
    broadcasterId: d.tokens.user_id,
    clientId: require('../auth').CLIENT_ID,
  };
}

// ============================================================
//  Автовыдача VIP при покупке награды
// ============================================================
async function addFromRedemption({ userId, username, rewardId, redeemedAt }) {
  const d = db.loadData();

  // Проверяем, что это та самая награда
  if (d.settings?.vipRewardId && rewardId !== d.settings.vipRewardId) {
    return { skipped: true };
  }

  const lower = String(username || '').trim().toLowerCase();
  if (!lower) return { error: 'Пустое имя' };

  const existing = (d.vips?.list || []).find(v => v.username.toLowerCase() === lower);
  const ctx = getTwitchContext();
  const api = getTwitchApi();

  // === Продление: если уже есть активный VIP ===
  if (existing && existing.expiresAt > Date.now()) {
    const newExpiresAt = existing.expiresAt + VIP_DURATION_MS;

    db.update(dd => {
      const item = dd.vips.list.find(v => v.username.toLowerCase() === lower);
      if (item) {
        item.expiresAt = newExpiresAt;
        item.lastSource = 'twitch';
        item.updatedAt = Date.now();
      }
    });

    broadcast();
    console.log(`[vips] продлил VIP для ${username} до ${new Date(newExpiresAt).toLocaleDateString('ru-RU')}`);
    return { ok: true, extended: true, expiresAt: newExpiresAt };
  }

  // === Новая выдача: нет VIP или истёк ===
  // Сначала пробуем выдать через Twitch API
  if (ctx && api?.addChannelVip) {
    try {
      await api.addChannelVip({
        token: ctx.token,
        clientId: ctx.clientId,
        broadcasterId: ctx.broadcasterId,
        userId,
      });
      console.log(`[vips] выдан VIP через Twitch: ${username}`);
    } catch (e) {
      console.error(`[vips] не удалось выдать VIP через Twitch для ${username}:`, e.message);
      return { error: 'Twitch API: ' + e.message };
    }
  } else {
    console.warn('[vips] нет доступа к Twitch API, выдаю только локально');
  }

  const now = Date.now();
  const expiresAt = now + VIP_DURATION_MS;

  db.update(dd => {
    if (!dd.vips) dd.vips = { list: [] };

    const item = dd.vips.list.find(v => v.username.toLowerCase() === lower);
    if (item) {
      item.expiresAt = expiresAt;
      item.grantedAt = now;
      item.userId = userId || item.userId;
      item.lastSource = 'twitch';
      item.updatedAt = now;
    } else {
      dd.vips.list.push({
        userId,
        username,
        grantedAt: now,
        expiresAt,
        lastSource: 'twitch',
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  broadcast();
  console.log(`[vips] выдал VIP для ${username} до ${new Date(expiresAt).toLocaleDateString('ru-RU')}`);
  return { ok: true, granted: true, expiresAt };
}

// ============================================================
//  Проверка и снятие истёкших VIP
// ============================================================
async function checkExpired() {
  const d = db.loadData();
  const list = d.vips?.list || [];
  const now = Date.now();

  const expired = list.filter(v => v.expiresAt && v.expiresAt < now);
  if (expired.length === 0) return { ok: true, removed: 0 };

  const ctx = getTwitchContext();
  const api = getTwitchApi();

  for (const v of expired) {
    // Пробуем снять через Twitch API
    if (ctx && api?.removeChannelVip && v.userId) {
      try {
        await api.removeChannelVip({
          token: ctx.token,
          clientId: ctx.clientId,
          broadcasterId: ctx.broadcasterId,
          userId: v.userId,
        });
        console.log(`[vips] снял VIP через Twitch: ${v.username}`);
      } catch (e) {
        console.warn(`[vips] не удалось снять VIP через Twitch для ${v.username}:`, e.message);
        // Не падаем — удалим из базы всё равно, чтобы не зацикливаться
      }
    }
  }

  // Удаляем из базы
  const expiredNames = expired.map(v => v.username.toLowerCase());
  db.update(dd => {
    dd.vips.list = (dd.vips.list || []).filter(
      v => !expiredNames.includes(v.username.toLowerCase())
    );
  });

  broadcast();
  return { ok: true, removed: expired.length };
}

// ============================================================
//  Ручное редактирование
// ============================================================

// Добавить или обновить VIP вручную
// days = сколько дней от текущего момента
function setManual({ username, days }) {
  const trimmed = String(username || '').trim();
  if (!trimmed) return { error: 'Пустое имя' };

  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return { error: 'Срок должен быть > 0' };

  const lower = trimmed.toLowerCase();
  const now = Date.now();
  const expiresAt = now + n * 24 * 60 * 60 * 1000;

  db.update(dd => {
    if (!dd.vips) dd.vips = { list: [] };

    const item = dd.vips.list.find(v => v.username.toLowerCase() === lower);
    if (item) {
      item.expiresAt = expiresAt;
      item.lastSource = 'manual';
      item.updatedAt = now;
    } else {
      dd.vips.list.push({
        userId: null,
        username: trimmed,
        grantedAt: now,
        expiresAt,
        lastSource: 'manual',
        manual: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  broadcast();
  return { ok: true };
}

// Изменить срок (кол-во дней от сегодня)
function setDays(username, days) {
  return setManual({ username, days });
}

// Удалить VIP (и снять через Twitch, если есть userId)
async function remove(username) {
  const lower = String(username || '').trim().toLowerCase();
  if (!lower) return { error: 'Пустое имя' };

  const d = db.loadData();
  const item = (d.vips?.list || []).find(v => v.username.toLowerCase() === lower);

  if (item?.userId) {
    const ctx = getTwitchContext();
    const api = getTwitchApi();
    if (ctx && api?.removeChannelVip) {
      try {
        await api.removeChannelVip({
          token: ctx.token,
          clientId: ctx.clientId,
          broadcasterId: ctx.broadcasterId,
          userId: item.userId,
        });
        console.log(`[vips] снял VIP через Twitch при удалении: ${item.username}`);
      } catch (e) {
        console.warn(`[vips] не удалось снять VIP через Twitch:`, e.message);
      }
    }
  }

  db.update(dd => {
    dd.vips.list = (dd.vips.list || []).filter(
      v => v.username.toLowerCase() !== lower
    );
  });

  broadcast();
  return { ok: true };
}

// Полный сброс (без снятия на Twitch)
function reset() {
  db.update(d => { d.vips = { list: [] }; });
  broadcast();
  return { ok: true };
}

module.exports = {
  init, getState,
  addFromRedemption, checkExpired,
  setManual, setDays, remove, reset,
};
