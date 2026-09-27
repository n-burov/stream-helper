// mechanics/donationBar.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  const goalName = d.donationBar?.goalName || '';
  const goalAmount = Number(d.donationBar?.goalAmount) || 0;
  const manualBase = Number(d.donationBar?.manualBase) || 0;
  const accumulated = Number(d.donationBar?.accumulated) || 0;

  const current = manualBase + accumulated;
  const percent = goalAmount > 0 ? Math.min(100, (current / goalAmount) * 100) : 0;

  return {
    goalName,
    goalAmount,
    manualBase,
    accumulated,
    current,
    percent: Math.round(percent * 10) / 10,
  };
}

// Установить цель и/или стартовую сумму вручную
function setGoal({ goalName, goalAmount, manualBase }) {
  const patch = {};
  if (typeof goalName === 'string') patch.goalName = goalName.trim();
  if (goalAmount !== undefined) patch.goalAmount = Math.max(0, Number(goalAmount) || 0);
  if (manualBase !== undefined) patch.manualBase = Math.max(0, Number(manualBase) || 0);

  db.update(d => {
    if (!d.donationBar) d.donationBar = { goalName: '', goalAmount: 0, manualBase: 0 };
    Object.assign(d.donationBar, patch);
  });

  ctxRef.broadcast('donationBar:state', getState());
  return { ok: true };
}

function refresh() {
  ctxRef.broadcast('donationBar:state', getState());
  return { ok: true };
}

function resetBar() {
  db.update(d => {
    // Сбрасываем полоску
    if (!d.donationBar) d.donationBar = { goalName: '', goalAmount: 0, manualBase: 0, accumulated: 0 };
    d.donationBar.manualBase = 0;
    d.donationBar.accumulated = 0;

    // Чистим "Донатеры (полоска)" — это stream, не weekly
    if (!d.donors) d.donors = { stream: { participants: [] }, weekly: { participants: [], lastResetAt: null } };
    if (!d.donors.stream) d.donors.stream = { participants: [] };
    d.donors.stream.participants = [];
  });

  ctxRef.broadcast('donors:state', require('./donors').getState());
  ctxRef.broadcast('donationBar:state', getState());
  return { ok: true };
}

function addToBar(amount) {
  const sum = Number(amount) || 0;
  if (sum <= 0) return { ok: true, skipped: true };

  db.update(d => {
    if (!d.donationBar) d.donationBar = { goalName: '', goalAmount: 0, manualBase: 0, accumulated: 0 };
    d.donationBar.accumulated = (Number(d.donationBar.accumulated) || 0) + sum;
  });

  ctxRef.broadcast('donationBar:state', getState());
  return { ok: true };
}

module.exports = { init, getState, setGoal, refresh, resetBar, addToBar };
