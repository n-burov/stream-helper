// mechanics/tops.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  const daily = d.tops?.daily?.participants || [];
  const monthly = d.tops?.monthly?.participants || [];

  return {
    daily: {
      leader: pickLeader(daily),
      participants: daily,
      resetAt: d.tops?.daily?.lastResetAt || null,
    },
    monthly: {
      leader: pickLeader(monthly),
      participants: monthly,
      resetAt: d.tops?.monthly?.lastResetAt || null,
    },
  };
}

function pickLeader(list) {
  if (!list || list.length === 0) return null;
  return [...list].sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0))[0];
}

function checkMonthlyReset() {
  const d = db.loadData();
  const last = d.tops?.monthly?.lastResetAt || 0;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();

  if (last < startOfMonth) {
    db.update(dd => {
      dd.tops.monthly.participants = [];
      dd.tops.monthly.lastResetAt = Date.now();
    });
    ctxRef.broadcast('tops:state', getState());
    return true;
  }
  return false;
}

function resetDaily() {
  db.update(d => {
    d.tops.daily.participants = [];
    d.tops.daily.lastResetAt = Date.now();
  });
  ctxRef.broadcast('tops:state', getState());
  return { ok: true };
}

function resetDailyManual() {
  return resetDaily();
}

function resetMonthlyManual() {
  db.update(d => {
    d.tops.monthly.participants = [];
    d.tops.monthly.lastResetAt = Date.now();
  });
  ctxRef.broadcast('tops:state', getState());
  return { ok: true };
}

function addDonation({ name, amount, currency, at }) {
  const trimmed = String(name || 'Аноним').trim() || 'Аноним';
  const sum = Number(amount) || 0;
  const ts = at || Date.now();

  db.update(d => {
    if (!d.tops) d.tops = { daily: { participants: [], lastResetAt: null }, monthly: { participants: [], lastResetAt: null } };
    addTo(d.tops.daily.participants, trimmed, sum, currency, ts);
    addTo(d.tops.monthly.participants, trimmed, sum, currency, ts);
  });

  ctxRef.broadcast('tops:state', getState());
  return { ok: true };
}

function addTo(list, name, amount, currency, ts) {
  const lower = name.toLowerCase();
  const existing = list.find(p => p.name.toLowerCase() === lower);

  if (existing) {
    existing.totalAmount = (existing.totalAmount || 0) + amount;
    existing.count = (existing.count || 0) + 1;
    existing.lastAt = ts;
    if (currency) existing.currency = currency;
  } else {
    list.push({
      name,
      totalAmount: amount,
      currency: currency || 'RUB',
      count: 1,
      lastAt: ts,
    });
  }
}

module.exports = {
  init, getState,
  checkMonthlyReset,
  resetDaily, resetDailyManual,
  resetMonthlyManual,
  addDonation,
};
