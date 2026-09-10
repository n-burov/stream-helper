// mechanics/wheel.js
const db = require('../db');
const winner = require('./winner');

let ctxRef = null;
const timers = new Map(); // spinId -> timeout

function init(ctx) { ctxRef = ctx; }

function getState() {
  return db.loadData().wheel;
}

function setSectors(sectors) {
  if (!Array.isArray(sectors)) return { error: 'Некорректный список секторов' };

  db.update(d => {
    d.wheel.sectors = sectors.map((s, i) => ({
      label: String(s.label || '').trim() || `Сектор ${i + 1}`,
      weight: Math.max(1, parseInt(s.weight) || 1),
      color: s.color || null,
    }));
  });

  ctxRef.broadcast('wheel:state', getState());
  return { ok: true };
}

function spin() {
  const d = db.loadData();
  const sectors = d.wheel.sectors;
  if (!sectors || sectors.length === 0) return { error: 'Нет секторов' };
  if (d.wheel.isSpinning) return { error: 'Уже вращается' };

  // === Выбор победителя взвешенно ===
  const totalWeight = sectors.reduce((sum, s) => sum + s.weight, 0);
  let rand = Math.random() * totalWeight;
  let winnerIndex = 0;
  let acc = 0;
  for (let i = 0; i < sectors.length; i++) {
    acc += sectors[i].weight;
    if (rand <= acc) { winnerIndex = i; break; }
  }

  // === Угол, при котором центр сектора победителя окажется сверху ===
  const sliceAngle = (sectors[winnerIndex].weight / totalWeight) * Math.PI * 2;
  let winnerStartAngle = 0;
  for (let i = 0; i < winnerIndex; i++) {
    winnerStartAngle += (sectors[i].weight / totalWeight) * Math.PI * 2;
  }
  const winnerMidAngle = winnerStartAngle + sliceAngle / 2;
  const baseTarget = -Math.PI / 2 - winnerMidAngle;

  // Небольшой случайный оффсет внутри сектора — чтобы колесо не останавливалось всегда в центр
  const maxOffset = sliceAngle * 0.35;
  const randomOffset = (Math.random() * 2 - 1) * maxOffset;

  // Приводим целевую позицию к [0, 2π)
  let normalizedTarget = (baseTarget + randomOffset) % (Math.PI * 2);
  if (normalizedTarget < 0) normalizedTarget += Math.PI * 2;

  // Текущее положение колеса
  const currentRot = d.wheel.currentRotation || 0;
  let currentNorm = currentRot % (Math.PI * 2);
  if (currentNorm < 0) currentNorm += Math.PI * 2;

  // Сколько нужно добавить, чтобы попасть в нормализованную цель
  let deltaToTarget = normalizedTarget - currentNorm;
  if (deltaToTarget < 0) deltaToTarget += Math.PI * 2;

  // + 15 полных оборотов для эффекта
  const extraSpins = 15 * Math.PI * 2;
  const targetAngle = currentRot + deltaToTarget + extraSpins;

  const spinId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const duration = 18000;
  const winnerLabel = sectors[winnerIndex].label;

  db.update(dd => {
    dd.wheel.isSpinning = true;
    dd.wheel.lastSpinId = spinId;
    dd.wheel.winner = null;
  });

  ctxRef.broadcast('wheel:spin', {
    spinId,
    targetAngle,
    duration,
    winnerIndex,
    winnerLabel,
    sectors,
  });

  // Сервер сам решает, когда спин завершён
  const t = setTimeout(() => {
    timers.delete(spinId);
    db.update(dd => {
      dd.wheel.isSpinning = false;
      dd.wheel.currentRotation = targetAngle % (Math.PI * 2);
      dd.wheel.winner = winnerLabel;
    });

    ctxRef.broadcast('wheel:completed', {
      spinId,
      winnerIndex,
      winnerLabel,
      currentRotation: targetAngle % (Math.PI * 2),
    });

    winner.showWinner({
      name: winnerLabel,
      title: 'Выигрыш!',
      subtitle: '🎡 Колесо фортуны',
      tag: '🎡 Колесо',
    });

    db.addHistoryEntry({
      mechanic: 'wheel',
      sectors: sectors.map(s => s.label),
      winners: [winnerLabel],
      status: 'finished',
      time: Date.now(),
    });
  }, duration + 500);

  timers.set(spinId, t);

  return { ok: true, spinId };
}

function resetAll() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();

  db.update(d => {
    d.wheel.sectors = [];
    d.wheel.isSpinning = false;
    d.wheel.currentRotation = 0;
    d.wheel.winner = null;
    d.wheel.lastSpinId = null;
  });

  ctxRef.broadcast('wheel:state', getState());
  return { ok: true };
}

module.exports = { init, getState, setSectors, spin, resetAll };