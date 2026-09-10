// mechanics/winner.js
// Просто хранит «последнего победителя» и рассылает его всем winner-оверлеям.
// Механики вызывают ctx.showWinner({...}), и это попадает сюда.

let currentWinner = null;
let ctxRef = null;

function init(ctx) {
  ctxRef = ctx;
}

function showWinner(payload) {
  currentWinner = { ...payload, at: Date.now() };
  ctxRef.broadcast('winner:show', currentWinner);
}

function getState() {
  return { current: currentWinner };
}

module.exports = { init, showWinner, getState };