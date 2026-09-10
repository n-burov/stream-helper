// mechanics/keyword.js
const db = require('../db');
const winner = require('./winner');

let ctxRef = null;

function init(ctx) { ctxRef = ctx; }

function getState() {
  const d = db.loadData();
  return d.keyword;
}

function start(word) {
  const w = (word || '').trim();
  if (!w) return { error: 'Пустое кодовое слово' };

  db.update(d => {
    d.keyword.status = 'collecting';
    d.keyword.word = w;
    d.keyword.participants = [];
    d.keyword.winners = [];
  });

  ctxRef.broadcast('keyword:state', getState());
  return { ok: true };
}

function stop() {
  const d = db.loadData();
  if (d.keyword.status !== 'collecting') return { error: 'Сбор не запущен' };

  db.update(dd => { dd.keyword.status = 'locked'; });
  ctxRef.broadcast('keyword:state', getState());

  db.addHistoryEntry({
    mechanic: 'keyword',
    word: d.keyword.word,
    participants: d.keyword.participants.length,
    winners: [],
    status: 'locked',
    time: Date.now(),
  });

  return { ok: true };
}

function draw() {
  const d = db.loadData();
  if (d.keyword.participants.length === 0) return { error: 'Нет участников' };
  if (d.keyword.status !== 'locked') return { error: 'Сначала остановите сбор' };

  const p = d.keyword.participants[Math.floor(Math.random() * d.keyword.participants.length)];

  db.update(dd => {
    dd.keyword.winners.push({ username: p.username, at: Date.now() });
    dd.keyword.status = 'finished';
  });

  const state = getState();
  ctxRef.broadcast('keyword:state', state);

  winner.showWinner({
    name: p.username,
    title: 'Победитель!',
    subtitle: '🎯 Розыгрыш по ключевому слову',
    tag: '🎯 Ключевое слово',
  });

  // обновляем запись в истории
  const history = db.loadHistory();
  if (history.length > 0 && history[0].mechanic === 'keyword' && history[0].status === 'locked') {
    history[0].status = 'finished';
    history[0].winners = state.winners.map(w => w.username);
    db.saveHistory(history);
  }

  return { ok: true, winner: p.username };
}

function reset() {
  db.update(d => {
    d.keyword.status = 'idle';
    d.keyword.participants = [];
    d.keyword.winners = [];
  });
  ctxRef.broadcast('keyword:state', getState());
  return { ok: true };
}

// Обработка сообщений чата: если собираем и текст == слово — добавляем участника
function handleChat(msg) {
  const d = db.loadData();
  if (d.keyword.status !== 'collecting') return;

  const text = msg.message.trim().toLowerCase();
  const word = d.keyword.word.trim().toLowerCase();
  if (text !== word) return;

  if (d.keyword.participants.some(p => p.userId === msg.userId)) return;

  const newParticipant = { userId: msg.userId, username: msg.username };

  db.update(dd => {
    dd.keyword.participants.push(newParticipant);
  });

  ctxRef.broadcast('keyword:participant', newParticipant);
}

module.exports = { init, getState, start, stop, draw, reset, handleChat };