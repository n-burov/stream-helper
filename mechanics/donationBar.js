// mechanics/donationBar.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  const goalName = d.donationBar?.goalName || '';
  const goalAmount = Number(d.donationBar?.goalAmount) || 0;
  const manualBase = Number(d.donationBar?.manualBase) || 0;

  const weekly = d.donors?.weekly?.participants || [];
  const weeklySum = weekly.reduce((sum, p) => sum + (Number(p.totalAmount) || 0), 0);

  // Итоговая сумма = ручная база + всё, что накопилось в weekly
  const current = manualBase + weeklySum;

  const percent = goalAmount > 0 ? Math.min(100, (current / goalAmount) * 100) : 0;

  return {
    goalName,
    goalAmount,
    manualBase,
    weeklySum,
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

// Обнуление полоски = сброс weekly + ручная база = 0
function resetBar() {
  db.update(d => {
    if (!d.donors) d.donors = { stream: { participants: [] }, weekly: { participants: [], lastResetAt: null } };
    if (!d.donors.weekly) d.donors.weekly = { participants: [], lastResetAt: null };
    d.donors.weekly.participants = [];
    d.donors.weekly.lastResetAt = Date.now();

    if (!d.donationBar) d.donationBar = { goalName: '', goalAmount: 0, manualBase: 0 };
    d.donationBar.manualBase = 0;
  });

  ctxRef.broadcast('donors:state', require('./donors').getState());
  ctxRef.broadcast('donationBar:state', getState());
  return { ok: true };
}

module.exports = { init, getState, setGoal, refresh, resetBar };
