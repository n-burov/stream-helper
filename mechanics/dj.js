// mechanics/dj.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  return {
    rewardIds: d.dj?.rewardIds || [],
    leader: d.dj?.leader || null,
    scores: d.dj?.scores || {},
  };
}

// Стример выбрал награды, которые учитываем
function setRewards(rewardIds) {
  if (!Array.isArray(rewardIds)) return { error: 'Некорректный список' };

  db.update(d => {
    d.dj.rewardIds = rewardIds.map(String);
    // Не сбрасываем scores — вдруг стример поменял настройки в середине стрима
  });

  ctxRef.broadcast('dj:state', getState());
  return { ok: true };
}

// Вызывается из EventSub при покупке награды
function addRedemption({ userId, username, rewardId, cost, avatar }) {
  const d = db.loadData();
  if (!d.dj.rewardIds.includes(rewardId)) {
    return { skipped: true };
  }

  const current = d.dj.scores[userId] || { username, points: 0, avatar };
  current.points += Number(cost) || 0;
  current.username = username; // на случай смены ника
  if (avatar) current.avatar = avatar;

  db.update(dd => {
    dd.dj.scores[userId] = current;
    // Пересчитываем лидера
    let leader = null;
    for (const [id, info] of Object.entries(dd.dj.scores)) {
      if (!leader || info.points > leader.points) {
        leader = { userId: id, username: info.username, points: info.points };
      }
    }
    dd.dj.leader = leader;
  });

  ctxRef.broadcast('dj:state', getState());
  return { ok: true };
}

// Сброс — вызывается при stream.offline / stream.online
function reset() {
  db.update(d => {
    d.dj.scores = {};
    d.dj.leader = null;
  });
  ctxRef.broadcast('dj:state', getState());
  return { ok: true };
}

module.exports = { init, getState, setRewards, addRedemption, reset };
