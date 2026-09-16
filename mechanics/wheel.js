// mechanics/wheel.js
const db = require('../db');
const winner = require('./winner');
const tickets = require('./tickets');

let ctxRef = null;
const timers = new Map();
const spinQueue = []; // очередь ожидающих спинов
let isProcessing = false;

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

// Публичная функция, которую вызывает server.js при донате и UI при ручной крутке
function spin(opts = {}) {
  // Если сейчас ничего не крутится — запускаем сразу
  // Если крутится — ставим в очередь
  const d = db.loadData();
  if (d.wheel.isSpinning) {
    spinQueue.push(opts);
    console.log(`[wheel] спин добавлен в очередь (${spinQueue.length} в очереди)`);
    return { ok: true, queued: true, queueSize: spinQueue.length };
  }

  return startSpin(opts);
}

// Непосредственный запуск одного спина
function startSpin(opts = {}) {
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

  const sliceAngle = (sectors[winnerIndex].weight / totalWeight) * Math.PI * 2;
  let winnerStartAngle = 0;
  for (let i = 0; i < winnerIndex; i++) {
    winnerStartAngle += (sectors[i].weight / totalWeight) * Math.PI * 2;
  }
  const winnerMidAngle = winnerStartAngle + sliceAngle / 2;
  const baseTarget = -Math.PI / 2 - winnerMidAngle;

  const maxOffset = sliceAngle * 0.35;
  const randomOffset = (Math.random() * 2 - 1) * maxOffset;

  let normalizedTarget = (baseTarget + randomOffset) % (Math.PI * 2);
  if (normalizedTarget < 0) normalizedTarget += Math.PI * 2;

  const currentRot = d.wheel.currentRotation || 0;
  let currentNorm = currentRot % (Math.PI * 2);
  if (currentNorm < 0) currentNorm += Math.PI * 2;

  let deltaToTarget = normalizedTarget - currentNorm;
  if (deltaToTarget < 0) deltaToTarget += Math.PI * 2;

  const extraSpins = 15 * Math.PI * 2;
  const targetAngle = currentRot + deltaToTarget + extraSpins;

  const spinId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const duration = 18000;
  const winnerLabel = sectors[winnerIndex].label;

  const donorName = opts.donorName || null;
  const donorAmount = opts.donorAmount || 0;

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

    // Авто-выдача билета
    let awardedTicket = false;
    if (donorName && /билет/i.test(winnerLabel)) {
      try {
        const result = tickets.incrementByUsername(donorName, 'wheel');
        awardedTicket = !!result.ok;
        console.log(`🎟️ Выпал сектор "${winnerLabel}" — выдаю билет для ${donorName}:`, result);
      } catch (e) {
        console.warn('⚠️ Не удалось добавить билет:', e.message);
      }
    }

    winner.showWinner({
      name: winnerLabel,
      title: 'Выигрыш!',
      subtitle: donorName
        ? `🎡 Колесо за донат от ${donorName}`
        : '🎡 Колесо фортуны',
      tag: donorName ? '🎡 Донат-колесо' : '🎡 Колесо',
    });

    if (donorName) {
      db.addHistoryEntry({
        mechanic: 'wheel-donation',
        donors: [donorName],
        donorAmount,
        winners: [winnerLabel],
        awardedTicket,
        status: 'finished',
        time: Date.now(),
      });
    } else {
      db.addHistoryEntry({
        mechanic: 'wheel',
        sectors: sectors.map(s => s.label),
        winners: [winnerLabel],
        status: 'finished',
        time: Date.now(),
      });
    }

    // === После завершения — проверяем очередь ===
    if (spinQueue.length > 0) {
      const nextOpts = spinQueue.shift();
      console.log(`[wheel] запускаю следующий спин из очереди, осталось: ${spinQueue.length}`);

      // Небольшая пауза, чтобы оверлей успел отрисовать победителя
      setTimeout(() => {
        startSpin(nextOpts);
      }, 2500); // 2.5 секунды между спинами
    }
  }, duration + 500);

  timers.set(spinId, t);

  return { ok: true, spinId };
}

function resetAll() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  spinQueue.length = 0;

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

// Для UI: узнать, сколько спинов в очереди
function getQueueSize() {
  return spinQueue.length;
}

module.exports = { init, getState, setSectors, spin, resetAll, getQueueSize };
