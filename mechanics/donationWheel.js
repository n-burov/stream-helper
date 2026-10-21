// mechanics/donationWheel.js
const db = require('../db');

let ctxRef = null;
let spinTimer = null;

function init(ctx) {
  ctxRef = ctx;
  const d = db.loadData();
  if (d.donationWheel?.isSpinning) {
    db.update(dd => { dd.donationWheel.isSpinning = false; });
  }
}

function getState() {
  const d = db.loadData();
  const w = d.donationWheel || { participants: [], winners: [], isSpinning: false, lastWinner: null };

  const bar = d.donationBar || {};
  const goalAmount = Number(bar.goalAmount) || 0;
  const current = (Number(bar.manualBase) || 0) + (Number(bar.accumulated) || 0);
  const percent = goalAmount > 0 ? Math.min(100, (current / goalAmount) * 100) : 0;

  const excludeWinners = !!d.settings?.donationWheelExcludeWinners;

  // Если участники ещё не зафиксированы — показываем актуальный список donors.stream
  let effectiveParticipants = w.participants || [];
  if (effectiveParticipants.length === 0) {
    const stream = (d.donors?.stream?.participants || [])
      .filter(p => Number(p.totalAmount) > 0)
      .map(p => ({ username: p.name, amount: Number(p.totalAmount) || 0 }));
    effectiveParticipants = stream;
  }

  // Сколько осталось участников
  const remaining = excludeWinners
    ? effectiveParticipants.filter(p => !(w.winners || []).includes(p.username))
    : effectiveParticipants;

  const canSpin =
    percent >= 100 &&
    !w.isSpinning &&
    remaining.length > (excludeWinners ? 1 : 0);

  return {
    participants: effectiveParticipants,
    winners: w.winners || [],
    isSpinning: !!w.isSpinning,
    lastWinner: w.lastWinner || null,
    barPercent: Math.round(percent * 10) / 10,
    barCurrent: current,
    barGoal: goalAmount,
    remainingCount: remaining.length,
    excludeWinners,
    canSpin,
    reason: !canSpin
      ? (percent < 100
          ? `Полоска заполнена на ${Math.round(percent)}% — розыгрыш недоступен`
          : w.isSpinning
            ? 'Идёт прокрутка...'
            : remaining.length === 0
              ? 'Нет участников с положительной суммой доната'
              : remaining.length <= 1 && excludeWinners
                ? 'Остался один участник — сбросьте полоску или выключите «Исключать победителя»'
                : ''
            )
      : null,
  };
}

function broadcast() {
  if (ctxRef) ctxRef.broadcast('donationWheel:state', getState());
}

function fixParticipants() {
  const d = db.loadData();
  const w = d.donationWheel || {};

  if (w.participants && w.participants.length > 0) return w.participants;

  const stream = (d.donors?.stream?.participants || [])
    .filter(p => Number(p.totalAmount) > 0)
    .map(p => ({ username: p.name, amount: Number(p.totalAmount) || 0 }));

  db.update(dd => {
    if (!dd.donationWheel) dd.donationWheel = { participants: [], winners: [], isSpinning: false, lastWinner: null };
    dd.donationWheel.participants = stream;
    dd.donationWheel.winners = [];
  });

  console.log(`[donationWheel] зафиксированы участники: ${stream.length}`);
  return stream;
}

function spin() {
  const d = db.loadData();
  const w = d.donationWheel || { participants: [], winners: [], isSpinning: false };
  const bar = d.donationBar || {};
  const excludeWinners = !!d.settings?.donationWheelExcludeWinners;

  const goalAmount = Number(bar.goalAmount) || 0;
  const current = (Number(bar.manualBase) || 0) + (Number(bar.accumulated) || 0);
  const percent = goalAmount > 0 ? (current / goalAmount) * 100 : 0;

  if (percent < 100) {
    return { error: `Полоска заполнена на ${Math.round(percent)}% — розыгрыш недоступен` };
  }

  if (w.isSpinning) {
    return { error: 'Уже идёт прокрутка' };
  }

  const participants = fixParticipants();
  if (participants.length === 0) {
    return { error: 'Нет участников с положительной суммой доната' };
  }

  const winners = w.winners || [];

  // Если исключение включено — берём только тех, кто ещё не выиграл
  // Если выключено — могут участвовать все
  const remaining = excludeWinners
    ? participants.filter(p => !winners.includes(p.username))
    : participants;

  if (remaining.length === 0) {
    return { error: 'Все участники уже выиграли — сбросьте полоску' };
  }
  if (excludeWinners && remaining.length <= 1) {
    return { error: 'Остался один участник — сбросьте полоску или выключите «Исключать победителя»' };
  }

  const totalWeight = remaining.reduce((sum, p) => sum + p.amount, 0);
  let rand = Math.random() * totalWeight;
  let winnerIndex = 0;
  let acc = 0;
  for (let i = 0; i < remaining.length; i++) {
    acc += remaining[i].amount;
    if (rand <= acc) { winnerIndex = i; break; }
  }

  const winner = remaining[winnerIndex];

  const sliceAngle = (winner.amount / totalWeight) * Math.PI * 2;
  let winnerStartAngle = 0;
  for (let i = 0; i < winnerIndex; i++) {
    winnerStartAngle += (remaining[i].amount / totalWeight) * Math.PI * 2;
  }
  const winnerMidAngle = winnerStartAngle + sliceAngle / 2;
  const baseTarget = -Math.PI / 2 - winnerMidAngle;

  const maxOffset = sliceAngle * 0.35;
  const randomOffset = (Math.random() * 2 - 1) * maxOffset;

  const extraSpins = 15 * Math.PI * 2;
  const targetAngle = baseTarget + randomOffset + extraSpins;

  const spinId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const duration = 18000;

  db.update(dd => {
    dd.donationWheel.isSpinning = true;
    dd.donationWheel.lastSpinId = spinId;
  });

  ctxRef.broadcast('donationWheel:spin', {
    spinId,
    targetAngle,
    duration,
    winnerIndex,
    winnerUsername: winner.username,
    winnerAmount: winner.amount,
    remaining,
    totalWeight,
  });

  if (spinTimer) clearTimeout(spinTimer);
  spinTimer = setTimeout(() => {
    spinTimer = null;

    const dd = db.loadData();
    // Победитель добавляется в историю побед ВСЕГДА (даже если исключение выключено)
    // Это нужно для отображения списка победителей.
    const newWinners = [...(dd.donationWheel.winners || []), winner.username];

    db.update(d => {
      d.donationWheel.isSpinning = false;
      d.donationWheel.winners = newWinners;
      d.donationWheel.lastWinner = winner.username;
    });

    console.log(`[donationWheel] победитель: ${winner.username} (${winner.amount}₽), исключение ${excludeWinners ? 'вкл' : 'выкл'}`);

    ctxRef.broadcast('donationWheel:completed', {
      spinId,
      winnerUsername: winner.username,
      winnerAmount: winner.amount,
      winners: newWinners,
      remainingCount: excludeWinners ? remaining.length - 1 : remaining.length,
    });

    broadcast();
  }, duration + 500);

  return { ok: true, spinId };
}

function setExcludeWinners(enabled) {
  db.update(d => {
    if (!d.settings) d.settings = {};
    d.settings.donationWheelExcludeWinners = !!enabled;
  });
  broadcast();
  console.log(`[donationWheel] исключение победителей: ${enabled ? 'вкл' : 'выкл'}`);
  return { ok: true, excludeWinners: !!enabled };
}

function resetWinners() {
  db.update(d => {
    if (!d.donationWheel) d.donationWheel = {};
    d.donationWheel.winners = [];
    d.donationWheel.participants = [];
    d.donationWheel.lastWinner = null;
    d.donationWheel.isSpinning = false;
    d.donationWheel.lastSpinId = null;
  });
  broadcast();
  console.log('[donationWheel] сброшен прогресс розыгрыша');
  return { ok: true };
}

function resetAll() {
  if (spinTimer) { clearTimeout(spinTimer); spinTimer = null; }
  db.update(d => {
    d.donationWheel = {
      participants: [],
      winners: [],
      isSpinning: false,
      lastWinner: null,
      lastSpinId: null,
    };
  });
  broadcast();
  console.log('[donationWheel] полный сброс');
  return { ok: true };
}

module.exports = {
  init, getState, broadcast,
  spin, resetWinners, resetAll, setExcludeWinners,
};
