// mechanics/index.js
const keyword = require('./keyword');
const wheel = require('./wheel');
const sniper = require('./sniper');
const winner = require('./winner');
const tickets = require('./tickets');
const donors = require('./donors');

function initAll(ctx) {
  winner.init(ctx);
  keyword.init(ctx);
  wheel.init(ctx);
  sniper.init(ctx);
  tickets.init(ctx);
  donors.init(ctx);
}

function handleCommand(action, data) {
  switch (action) {
    case 'keyword:start':    return keyword.start(data?.word);
    case 'keyword:stop':     return keyword.stop();
    case 'keyword:draw':     return keyword.draw();
    case 'keyword:reset':    return keyword.reset();

    case 'wheel:setSectors': return wheel.setSectors(data?.sectors);
    case 'wheel:spin':       return wheel.spin();
    case 'wheel:reset':      return wheel.resetAll();

    case 'sniper:add':       return sniper.addParticipant(data?.name);
    case 'sniper:import':    return sniper.importFrom(data?.names);
    case 'sniper:remove':    return sniper.removeParticipant(data?.id);
    case 'sniper:shoot':     return sniper.shoot();
    case 'sniper:reset':     return sniper.reset();

    case 'tickets:add':      return tickets.addManual(data?.name);
    case 'tickets:remove':   return tickets.removeByName(data?.name);
    case 'tickets:setCount': return tickets.setCount(data?.name, data?.count);
    case 'tickets:reset':    return tickets.reset();

    case 'donors:add':       return donors.addManual(data?.name);
    case 'donors:remove':    return donors.removeAt(data?.index);
    case 'donors:reset':     return donors.reset();

    default:
      return { error: 'Unknown action: ' + action };
  }
}

function getFullState() {
  return {
    keyword: keyword.getState(),
    wheel: wheel.getState(),
    sniper: sniper.getState(),
    winner: winner.getState(),
    tickets: tickets.getState(),
    donors: donors.getState(),
  };
}

function handleChat(msg) {
  keyword.handleChat(msg);
}

module.exports = {
  initAll, handleCommand, getFullState, handleChat,
  tickets, donors, sniper,
};