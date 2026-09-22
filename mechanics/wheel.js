// mechanics/wheel.js
const db = require('../db');
const winner = require('./winner');
const tickets = require('./tickets');

let ctxRef = null;
const timers = new Map(); // spinId -> timeout
const spinQueue = [];     // очередь ожидающих спинов

function init(ctx) { ctxRef = ctx; }

function getState() {
  return db.loadData().wheel;
}

function getQueueSize() {
  return spinQueue.length;
}

// Внутренняя функция: рассылаем размер очереди всем клиентам
function broadcastQueue() {
  if (!ctxRef) return;
  ctxRef.broadcast('wheel:queue', { size: spinQueue.length });
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
  const d = db.loadData();
  if (d.wheel.isSpinning) {
    spinQueue.push(opts);
    console.log(`[wheel] спин добавлен в очередь (${spinQueue.length} в очереди)`);
    broadcastQueue();
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

  // === Угол, при котором центр сектора победителя окажется сверху ===
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
    donorName,
    donorAmount,
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

    // === АВТО-ВЫДАЧА БИЛЕТА ===
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

    // Показываем победителя
    winner.showWinner({
      name: winnerLabel,
      title: 'Выигрыш!',
      subtitle: donorName
        ? `🎡 Колесо за донат от ${donorName}`
        : '🎡 Колесо фортуны',
      tag: donorName ? '🎡 Донат-колесо' : '🎡 Колесо',
    });

    // Запись в историю
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

    // === Проверяем очередь ===
    if (spinQueue.length > 0) {
      const nextOpts = spinQueue.shift();
      console.log(`[wheel] запускаю следующий спин из очереди, осталось: ${spinQueue.length}`);
      broadcastQueue();

      setTimeout(() => {
        startSpin(nextOpts);
      }, 2500);
    }
  }, duration + 500);

  timers.set(spinId, t);

  return { ok: true, spinId };
}

function forceProcessQueue() {
  const d = db.loadData();

  // Сбрасываем текущее состояние спина
  db.update(dd => {
    dd.wheel.isSpinning = false;
  });

  // Чистим все таймеры
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();

  if (spinQueue.length === 0) {
    ctxRef.broadcast('wheel:state', getState());
    broadcastQueue();
    console.log('[wheel] очередь пуста, нечего подталкивать');
    return { ok: true, message: 'Очередь пуста', queueSize: 0 };
  }

  // Берём следующий спин из очереди и запускаем
  const nextOpts = spinQueue.shift();
  console.log(`[wheel] принудительный запуск из очереди, осталось: ${spinQueue.length}`);
  broadcastQueue();

  // Запускаем следующий спин
  setTimeout(() => {
    startSpin(nextOpts);
  }, 300);

  return { ok: true, message: 'Запущен следующий спин', queueSize: spinQueue.length };
}

function resetAll() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  spinQueue.length = 0;
  broadcastQueue();

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

module.exports = {
  init, getState, setSectors, spin, resetAll, getQueueSize,
  forceProcessQueue,
};
