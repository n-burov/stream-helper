// mechanics/sniper.js
const db = require('../db');
const winner = require('./winner');

let ctxRef = null;
const timers = new Map();

function init(ctx) { ctxRef = ctx; }

function getState() {
  return db.loadData().sniper;
}

function addParticipant(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { error: 'Пустое имя' };

  let created = null;
  db.update(d => {
    created = { id: d.sniper.nextId++, name: trimmed, alive: true };
    d.sniper.participants.push(created);
    if (d.sniper.status === 'winner') {
      d.sniper.status = 'idle';
      d.sniper.winnerName = null;
    }
  });

  ctxRef.broadcast('sniper:state', getState());
  return { ok: true, participant: created };
}

// Импорт списка: заменяет текущий список снайпера
function importFrom(names) {
  if (!Array.isArray(names) || names.length === 0) {
    return { error: 'Список пуст' };
  }

  // Уникализируем ники без учёта регистра
  const seen = new Set();
  const unique = [];
  for (const n of names) {
    const trimmed = String(n || '').trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    unique.push(trimmed);
  }

  db.update(d => {
    d.sniper.participants = unique.map((name, i) => ({
      id: i + 1,
      name,
      alive: true,
    }));
    d.sniper.nextId = unique.length + 1;
    d.sniper.status = 'idle';
    d.sniper.victimId = null;
    d.sniper.winnerName = null;
  });

  ctxRef.broadcast('sniper:state', getState());
  return { ok: true, imported: unique.length };
}

function removeParticipant(id) {
  db.update(d => {
    d.sniper.participants = d.sniper.participants.filter(p => p.id !== id);
  });
  ctxRef.broadcast('sniper:state', getState());
  return { ok: true };
}

function reset() {
  for (const t of timers.values()) {
    if (t.aim) clearTimeout(t.aim);
    if (t.shot) clearTimeout(t.shot);
  }
  timers.clear();

  db.update(d => {
    d.sniper.status = 'idle';
    d.sniper.participants = [];
    d.sniper.victimId = null;
    d.sniper.winnerName = null;
    d.sniper.nextId = 1;
  });

  ctxRef.broadcast('sniper:state', getState());
  return { ok: true };
}

function shoot() {
  const d = db.loadData();
  if (d.sniper.status === 'shooting') return { error: 'Уже стреляем' };

  const alive = d.sniper.participants.filter(p => p.alive);

  if (alive.length <= 1) {
    if (alive.length === 1) {
      declareWinner(alive[0].name);
      return { ok: true, winner: alive[0].name };
    }
    return { error: 'Недостаточно живых участников' };
  }

  const victim = alive[Math.floor(Math.random() * alive.length)];
  const spinId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const aimDuration = 2200 + Math.random() * 600;

  db.update(dd => {
    dd.sniper.status = 'shooting';
    dd.sniper.victimId = victim.id;
  });

  ctxRef.broadcast('sniper:shooting', {
    spinId,
    victimId: victim.id,
    aimDuration,
    participants: d.sniper.participants,
  });

  const aimTimer = setTimeout(() => {
    const cur = db.loadData();
    const victimP = cur.sniper.participants.find(p => p.id === victim.id);
    if (!victimP || !victimP.alive) return;

    db.update(dd => {
      const p = dd.sniper.participants.find(x => x.id === victim.id);
      if (p) p.alive = false;
      dd.sniper.status = 'shot';
      dd.sniper.victimId = null;
    });

    ctxRef.broadcast('sniper:shot', {
      spinId,
      victimId: victim.id,
      victimName: victim.name,
      participants: db.loadData().sniper.participants,
    });

    const after = db.loadData().sniper.participants.filter(p => p.alive);

    const shotTimer = setTimeout(() => {
      timers.delete(spinId);
      if (after.length === 1) {
        declareWinner(after[0].name);
      } else if (after.length === 0) {
        db.update(dd => { dd.sniper.status = 'idle'; });
        ctxRef.broadcast('sniper:state', getState());
      } else {
        db.update(dd => { dd.sniper.status = 'idle'; });
        ctxRef.broadcast('sniper:state', getState());
      }
    }, 1800);

    timers.set(spinId, { shot: shotTimer });
  }, aimDuration);

  timers.set(spinId, { aim: aimTimer });

  return { ok: true, victimId: victim.id, spinId };
}

function declareWinner(name) {
  db.update(d => {
    d.sniper.status = 'winner';
    d.sniper.winnerName = name;
  });

  ctxRef.broadcast('sniper:state', getState());

  winner.showWinner({
    name,
    title: 'Победитель!',
    subtitle: '🔫 Выжил в снайперской дуэли',
    tag: '🔫 Снайпер',
  });

  db.addHistoryEntry({
    mechanic: 'sniper',
    winners: [name],
    participants: db.loadData().sniper.participants.map(p => p.name),
    status: 'finished',
    time: Date.now(),
  });
}

module.exports = {
  init, getState, addParticipant, importFrom,
  removeParticipant, reset, shoot,
};