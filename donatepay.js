// donatepay.js
const EventEmitter = require('events');
const db = require('./db');

const API_BASE = 'https://donatepay.ru/api/v1';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;


// Возвращает timestamp начала текущей недели (понедельник 00:00 локального времени)
function startOfWeek(now = new Date()) {
  const d = new Date(now);
  const day = d.getDay();           // 0 = воскресенье, 1 = понедельник
  const diff = (day === 0 ? 6 : day - 1); // сколько дней назад был понедельник
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

class DonatePayService extends EventEmitter {
  constructor({ token }) {
    super();

    this.token = token;
    this.refreshTimer = null;
    this.shouldRefresh = false;
    this.rateLimitedUntil = 0;
    this.consecutiveRateLimits = 0;

    console.log('[donatepay] using token:',
      this.token.slice(0, 10) + '...' + this.token.slice(-6));
  }

  async start() {
    this.shouldRefresh = true;
    this.emit('connected');
    await this.refreshDonors();
    this.scheduleNext();
  }

  stop() {
    this.shouldRefresh = false;
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
  }

  async connect() { return this.start(); }
  disconnect() { this.stop(); }

  scheduleNext() {
    if (!this.shouldRefresh) return;
    const now = Date.now();
    const delay = Math.max(REFRESH_INTERVAL_MS, this.rateLimitedUntil - now);
    this.refreshTimer = setTimeout(() => {
      this.refreshDonors().then(() => this.scheduleNext());
    }, delay);
  }

  async refreshDonors() {
    if (!this.shouldRefresh) return;
    if (Date.now() < this.rateLimitedUntil) return;

    try {
      const url = `${API_BASE}/transactions` +
        `?access_token=${encodeURIComponent(this.token)}` +
        `&type=donation&limit=100&order=DESC`;

      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TwitchOverlay/1.0',
        },
      });

      if (res.status === 429) {
        this.consecutiveRateLimits++;
        const waitMs = Math.min(60_000 * Math.pow(2, this.consecutiveRateLimits - 1), 600_000);
        this.rateLimitedUntil = Date.now() + waitMs;
        this.emit('error',
          `DonatePay: rate limit #${this.consecutiveRateLimits}, повтор через ${waitMs / 1000}с.`);
        return;
      }

      const text = await res.text();
      if (text.trim().startsWith('<')) throw new Error('HTML вместо JSON');

      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error('Невалидный JSON: ' + text.slice(0, 200)); }

      if (data?.status === 'error') {
        throw new Error('DonatePay: ' + (data.message || 'неизвестная ошибка'));
      }

      this.consecutiveRateLimits = 0;

      const transactions = data?.data || [];
      if (!Array.isArray(transactions)) throw new Error('Неожиданный формат data');

      // ==== ГЛАВНОЕ: определяем нижнюю границу ====
      const d = db.loadData();
      const weekStart = startOfWeek();
      const resetAt = d.donors?.resetAt || 0;
      const cutoff = Math.max(weekStart, resetAt);

      console.log('[donatepay] cutoff:', new Date(cutoff).toISOString(),
                  '(weekStart:', new Date(weekStart).toISOString(),
                  ', resetAt:', resetAt ? new Date(resetAt).toISOString() : 'null)');

      // Фильтруем: только транзакции после cutoff
      const recent = transactions.filter(t => {
        const ts = new Date(t.created_at).getTime();
        return ts >= cutoff;
      });

      // Группируем по имени
      const donorsMap = new Map();
      for (const t of recent) {
        const name = String(t.what || t.vars?.name || 'Аноним').trim();
        if (!name) continue;

        const key = name.toLowerCase();
        const amount = parseFloat(t.sum) || 0;
        const currency = t.currency || 'RUB';
        const ts = new Date(t.created_at).getTime();

        if (donorsMap.has(key)) {
          const existing = donorsMap.get(key);
          existing.totalAmount += amount;
          existing.count += 1;
          if (ts > existing.lastAt) existing.lastAt = ts;
        } else {
          donorsMap.set(key, {
            name, totalAmount: amount, currency, count: 1, lastAt: ts,
          });
        }
      }

      const donors = Array.from(donorsMap.values());

      db.update(dd => {
        dd.donors.participants = donors;
      });

      console.log(`[donatepay] донатеров за период: ${donors.length} (из ${recent.length} транзакций)`);
      this.emit('donorsUpdated', { participants: donors });
    } catch (e) {
      this.emit('error', e.message);
    }
  }

  async forceRefresh() {
    this.rateLimitedUntil = 0;
    await this.refreshDonors();
  }
}

module.exports = { DonatePayService };
