// mechanics/vips.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

const VIP_DURATION_DAYS = 30;
const VIP_DURATION_MS = VIP_DURATION_DAYS * 24 * 60 * 60 * 1000;

// ============================================================
//  Утилиты
// ============================================================

function daysLeft(expiresAt) {
  return Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
}

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
//  Контекст Twitch
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
        if (userId) item.userId = userId;
      }
    });

    broadcast();
    console.log(`[vips] продлил VIP для ${username} до ${new Date(newExpiresAt).toLocaleDateString('ru-RU')}`);
    return { ok: true, extended: true, expiresAt: newExpiresAt };
  }

  // === Новая выдача ===
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
      }
    }
  }

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

// Добавить или обновить VIP вручную (с автопоиском userId)
async function setManual({ username, days, userId: explicitUserId }) {
  const trimmed = String(username || '').trim();
  if (!trimmed) return { error: 'Пустое имя' };

  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return { error: 'Срок должен быть > 0' };

  const lower = trimmed.toLowerCase();
  const now = Date.now();
  const expiresAt = now + n * 24 * 60 * 60 * 1000;

  // === Ищем userId: сначала явно переданный, потом — через API ===
  let userId = explicitUserId || null;

  if (!userId) {
    const ctx = getTwitchContext();
    const api = getTwitchApi();

    if (ctx && api?.getUserByLogin) {
      try {
        const user = await api.getUserByLogin({
          token: ctx.token,
          clientId: ctx.clientId,
          login: trimmed,
        });

        if (user?.id) {
          userId = user.id;
          console.log(`[vips] найден Twitch ID для ${trimmed}: ${userId}`);
        } else {
          console.warn(`[vips] Twitch-юзер "${trimmed}" не найден — VIP будет только локально`);
        }
      } catch (e) {
        console.warn(`[vips] ошибка поиска Twitch ID для ${trimmed}:`, e.message);
      }
    } else {
      console.warn('[vips] нет доступа к Twitch API — userId не будет найден');
    }
  }

  db.update(dd => {
    if (!dd.vips) dd.vips = { list: [] };

    const item = dd.vips.list.find(v => v.username.toLowerCase() === lower);
    if (item) {
      item.expiresAt = expiresAt;
      item.lastSource = 'manual';
      item.updatedAt = now;
      if (userId) item.userId = userId;
      if (item.grantedAt == null) item.grantedAt = now;
    } else {
      dd.vips.list.push({
        userId,
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
  return {
    ok: true,
    userId: userId,
    foundOnTwitch: !!userId,
    expiresAt,
  };
}

// Изменить срок (кол-во дней от сегодня)
function setDays(username, days) {
  return setManual({ username, days });
}

// ============================================================
//  РУЧНОЕ СНЯТИЕ VIP (даже если срок не истёк)
// ============================================================
async function revokeManually(username, { forceLocal = false } = {}) {
  const trimmed = String(username || '').trim();
  if (!trimmed) return { error: 'Пустое имя' };

  const lower = trimmed.toLowerCase();
  const d = db.loadData();
  const item = (d.vips?.list || []).find(v => v.username.toLowerCase() === lower);

  if (!item) return { error: 'VIP не найден в базе' };

  // === forceLocal: просто удалить из базы, не трогая Twitch ===
  if (forceLocal) {
    db.update(dd => {
      dd.vips.list = (dd.vips.list || []).filter(
        v => v.username.toLowerCase() !== lower
      );
    });
    broadcast();
    console.log(`[vips] удалён локально (без Twitch): ${item.username}`);
    return { ok: true, revoked: true, localOnly: true, username: item.username };
  }

  // === Обычный путь: пробуем снять через Twitch ===
  if (item.userId) {
    const ctx = getTwitchContext();
    const api = getTwitchApi();

    if (!ctx) {
      return {
        error: 'Twitch не подключён',
        hint: 'Стример не авторизован в Twitch — снять VIP через API невозможно',
        canForceLocal: true,
      };
    }

    if (!api?.removeChannelVip) {
      return {
        error: 'Twitch API недоступно',
        hint: 'Модуль twitch-api не загружен',
        canForceLocal: true,
      };
    }

    try {
      await api.removeChannelVip({
        token: ctx.token,
        clientId: ctx.clientId,
        broadcasterId: ctx.broadcasterId,
        userId: item.userId,
      });

      console.log(`[vips] вручную снят VIP через Twitch: ${item.username}`);

      db.update(dd => {
        dd.vips.list = (dd.vips.list || []).filter(
          v => v.username.toLowerCase() !== lower
        );
      });
      broadcast();
      return { ok: true, revoked: true, username: item.username };

    } catch (e) {
      const msg = String(e.message || '').toLowerCase();

      // Twitch вернул "юзер не VIP" — не критично, предлагаем удалить локально
      const isNotVipError =
        msg.includes('user is not a vip') ||
        msg.includes('not a vip') ||
        msg.includes('no vip') ||
        msg.includes('404');

      if (isNotVipError) {
        console.warn(`[vips] на Twitch у ${item.username} нет VIP — можно удалить локально`);
        return {
          error: 'На Twitch у этого зрителя нет VIP',
          hint: 'Запись есть только в базе. Хотите удалить её локально?',
          canForceLocal: true,
        };
      }

      console.error(`[vips] ошибка снятия VIP через Twitch:`, e.message);
      return {
        error: 'Twitch API: ' + e.message,
        hint: 'Проверьте, что приложение авторизовано в Twitch со scope channel:manage:vips',
        canForceLocal: true,
      };
    }
  }

  // userId нет — снимать на Twitch нечего, удаляем локально
  console.warn(`[vips] у ${item.username} нет userId — удаляю только локально`);
  db.update(dd => {
    dd.vips.list = (dd.vips.list || []).filter(
      v => v.username.toLowerCase() !== lower
    );
  });
  broadcast();
  return {
    ok: true,
    revoked: true,
    localOnly: true,
    username: item.username,
    note: 'userId не найден — VIP снят только из базы',
  };
}

// Удалить из базы без Twitch
function removeLocal(username) {
  return revokeManually(username, { forceLocal: true });
}

// Алиас для удаления (используется в UI)
async function remove(username) {
  return revokeManually(username);
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
  setManual, setDays, remove, removeLocal, revokeManually, reset,
};
