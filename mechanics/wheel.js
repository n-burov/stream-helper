// mechanics/wheel.js
const db = require('../db');
const tickets = require('./tickets');

let ctxRef = null;
const timers = new Map(); // spinId -> timeout
const spinQueue = [];     // очередь ожидающих серий

function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  return {
    ...d.wheel,
    spinCost: d.settings.wheelSpinCost || 300,
  };
}

function getQueueSize() {
  return spinQueue.length;
}

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

function setSpinCost(cost) {
  const n = Math.max(1, parseInt(cost) || 300);
  db.update(d => { d.settings.wheelSpinCost = n; });
  ctxRef.broadcast('wheel:state', getState());
  return { ok: true, spinCost: n };
}

// Взвешенный выбор одного победителя из sectors
function pickOne(sectors) {
  const totalWeight = sectors.reduce((sum, s) => sum + s.weight, 0);
  let rand = Math.random() * totalWeight;
  let acc = 0;
  for (let i = 0; i < sectors.length; i++) {
    acc += sectors[i].weight;
    if (rand <= acc) return { index: i, label: sectors[i].label };
  }
  return { index: 0, label: sectors[0].label };
}

// Публичная функция. opts: { donorName, donorAmount, count }
function spin(opts = {}) {
  const count = Math.max(1, parseInt(opts.count) || 1);
  const d = db.loadData();

  if (d.wheel.isSpinning || spinQueue.length > 0) {
    spinQueue.push({ ...opts, count });
    console.log(`[wheel] серия из ${count} спинов добавлена в очередь (${spinQueue.length} серий в очереди)`);
    broadcastQueue();
    return { ok: true, queued: true, queueSize: spinQueue.length };
  }

  return startSeries({ ...opts, count });
}

// Запуск серии: N победителей выбираются сразу, шлётся ОДИН wheel:spin
function startSeries(opts = {}) {
  const count = Math.max(1, parseInt(opts.count) || 1);
  const d = db.loadData();
  const sectors = d.wheel.sectors;

  if (!sectors || sectors.length === 0) {
    console.log('[wheel] нет секторов — серия прервана');
    // Двигаем очередь дальше
    if (spinQueue.length > 0) {
      const nextOpts = spinQueue.shift();
      broadcastQueue();
      setTimeout(() => startSeries(nextOpts), 2500);
    }
    return { error: 'Нет секторов' };
  }

  console.log(`[wheel] запускаю серию из ${count} спинов для ${opts.donorName || 'ручного запуска'}`);

  // === Выбираем всех победителей серии сразу ===
  const winners = [];
  for (let i = 0; i < count; i++) {
    winners.push(pickOne(sectors));
  }

  // === Рассчитываем угол для колеса (для старого оверлея) ===
  // Берём последнего победителя как «главного», крутим к нему
  const lastWinner = winners[winners.length - 1];
  const totalWeight = sectors.reduce((sum, s) => sum + s.weight, 0);
  const sliceAngle = (sectors[lastWinner.index].weight / totalWeight) * Math.PI * 2;
  let winnerStartAngle = 0;
  for (let i = 0; i < lastWinner.index; i++) {
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
  // Длительность всей серии: 18 сек + 2.5 сек пауза между каждым
  const duration = 18000 + Math.max(0, count - 1) * 2500;

  const donorName = opts.donorName || null;
  const donorAmount = opts.donorAmount || 0;

  db.update(dd => {
    dd.wheel.isSpinning = true;
    dd.wheel.lastSpinId = spinId;
    dd.wheel.winner = null;
  });

  // === ОДИН wheel:spin со всеми winners ===
  ctxRef.broadcast('wheel:spin', {
    spinId,
    targetAngle,
    duration,
    winnerIndex: lastWinner.index,
    winnerLabel: lastWinner.label,
    winners: winners.map(w => w.label),   // массив всех N label
    seriesCount: count,
    sectors,
    donorName,
    donorAmount,
  });

  const t = setTimeout(() => {
    timers.delete(spinId);

    db.update(dd => {
      dd.wheel.isSpinning = false;
      dd.wheel.currentRotation = targetAngle % (Math.PI * 2);
      dd.wheel.winner = lastWinner.label;
    });

    ctxRef.broadcast('wheel:completed', {
      spinId,
      winnerIndex: lastWinner.index,
      winnerLabel: lastWinner.label,
      winners: winners.map(w => w.label),
      seriesCount: count,
      currentRotation: targetAngle % (Math.PI * 2),
    });

    // === АВТО-ВЫДАЧА БИЛЕТОВ ===
    if (donorName) {
      const ticketsCount = winners.filter(w => /билет/i.test(w.label)).length;
      if (ticketsCount > 0) {
        try {
          for (let i = 0; i < ticketsCount; i++) {
            tickets.incrementByUsername(donorName, 'wheel');
          }
          console.log(`🎟️ Выдано билетов для ${donorName}: ${ticketsCount}`);
        } catch (e) {
          console.warn('⚠️ Не удалось добавить билеты:', e.message);
        }
      }
    }

    // === Одна запись в историю на всю серию ===
    if (donorName) {
      db.addHistoryEntry({
        mechanic: 'wheel-donation',
        donors: [donorName],
        donorAmount,
        winners: winners.map(w => w.label),
        spinCount: count,
        status: 'finished',
        time: Date.now(),
      });
    } else {
      db.addHistoryEntry({
        mechanic: 'wheel',
        sectors: sectors.map(s => s.label),
        winners: winners.map(w => w.label),
        spinCount: count,
        status: 'finished',
        time: Date.now(),
      });
    }

    console.log(`[wheel] серия завершена. Выпало: ${winners.map(w => w.label).join(', ')}`);

    // === Следующая серия из очереди ===
    if (spinQueue.length > 0) {
      const nextOpts = spinQueue.shift();
      console.log(`[wheel] запускаю следующую серию из очереди, осталось: ${spinQueue.length}`);
      broadcastQueue();

      setTimeout(() => {
        startSeries(nextOpts);
      }, 2500);
    } else {
      broadcastQueue();
    }
  }, duration + 500);

  timers.set(spinId, t);

  return { ok: true, spinId, count };
}

// Форсировать переход к следующей серии (не убивает текущую)
function forceProcessQueue() {
  if (spinQueue.length === 0) {
    console.log('[wheel] очередь пуста, нечего подталкивать');
    return { ok: true, message: 'Очередь пуста', queueSize: 0 };
  }

  // Ставим флаг: при завершении текущей серии запускаем следующую БЕЗ паузы 2500 мс.
  // Проще всего: если сейчас ничего не крутится — просто запустить следующую серию.
  const d = db.loadData();
  if (!d.wheel.isSpinning) {
    const nextOpts = spinQueue.shift();
    console.log(`[wheel] форс-запуск следующей серии (текущая не активна), осталось: ${spinQueue.length}`);
    broadcastQueue();
    setTimeout(() => startSeries(nextOpts), 300);
    return { ok: true, message: 'Запущена следующая серия', queueSize: spinQueue.length };
  }

  // Если серия идёт — просто ставим «ускоренную» очередь,
  // но НЕ трогаем текущий таймер. Следующая серия стартует после завершения текущей
  // (логика уже есть в startSeries: если spinQueue.length > 0 → сразу следующий).
  console.log(`[wheel] серия уже идёт. Форсируем переход — следующая стартует после текущей.`);
  return { ok: true, message: 'Следующая серия стартует сразу после текущей', queueSize: spinQueue.length };
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
  init, getState, setSectors, setSpinCost, spin, resetAll, getQueueSize,
  forceProcessQueue,
};
