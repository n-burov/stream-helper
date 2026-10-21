// mechanics/gifMaster.js
const db = require('../db');

let ctxRef = null;
function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  return {
    rewardIds: d.gifMaster?.rewardIds || [],
    leader: d.gifMaster?.leader || null,
    scores: d.gifMaster?.scores || {},
  };
}

// Стример выбрал награды, которые учитываем
function setRewards(rewardIds) {
  if (!Array.isArray(rewardIds)) return { error: 'Некорректный список' };

  db.update(d => {
    d.gifMaster.rewardIds = rewardIds.map(String);
  });

  ctxRef.broadcast('gifMaster:state', getState());
  return { ok: true };
}

// Вызывается из EventSub при покупке награды
function addRedemption({ userId, username, rewardId, cost, avatar }) {
  const d = db.loadData();

  // Игнорируем покупки самого стримера
  const broadcasterLogin = d.tokens?.login;
  if (broadcasterLogin && username && username.toLowerCase() === broadcasterLogin.toLowerCase()) {
    console.log('[gifMaster] Пропускаю покупку стримера:', username);
    return { skipped: true, reason: 'broadcaster' };
  }

  if (!d.gifMaster.rewardIds.includes(rewardId)) {
    return { skipped: true };
  }

  const current = d.gifMaster.scores[userId] || { username, points: 0, avatar };
  current.points += Number(cost) || 0;
  current.username = username;
  if (avatar) current.avatar = avatar;

  db.update(dd => {
    dd.gifMaster.scores[userId] = current;
    // Пересчитываем лидера
    let leader = null;
    for (const [id, info] of Object.entries(dd.gifMaster.scores)) {
      if (!leader || info.points > leader.points) {
        leader = { userId: id, username: info.username, points: info.points };
      }
    }
    dd.gifMaster.leader = leader;
  });

  ctxRef.broadcast('gifMaster:state', getState());
  return { ok: true };
}

// Сброс — вызывается при stream.offline / stream.online
function reset() {
  db.update(d => {
    d.gifMaster.scores = {};
    d.gifMaster.leader = null;
  });
  ctxRef.broadcast('gifMaster:state', getState());
  return { ok: true };
}

module.exports = { init, getState, setRewards, addRedemption, reset };
