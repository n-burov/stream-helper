// mechanics/index.js
const keyword = require('./keyword');
const wheel = require('./wheel');
const sniper = require('./sniper');
const winner = require('./winner');
const tickets = require('./tickets');
const donors = require('./donors');
const dj = require('./dj');
const nicks = require('./nicks');
const tops = require('./tops');
const announcements = require('./announcements');
const donationBar = require('./donationBar');

function initAll(ctx) {
  winner.init(ctx);
  keyword.init(ctx);
  wheel.init(ctx);
  sniper.init(ctx);
  tickets.init(ctx);
  donors.init(ctx);
  dj.init(ctx);
  nicks.init(ctx);
  tops.init(ctx);
  announcements.init(ctx);
  donationBar.init(ctx);
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

    case 'donors:add':         return donors.addManual(data?.list, data?.name);
    case 'donors:remove':      return donors.removeAt(data?.list, data?.index);
    case 'donors:reset':       return donors.reset(data?.list);
    case 'donors:checkWeekly': return donors.checkWeeklyReset();

    case 'dj:setRewards':    return dj.setRewards(data?.rewardIds);
    case 'dj:reset':         return dj.reset();

    case 'nicks:addManual':  return nicks.addManual(data?.twitchUsername, data?.nick);
    case 'nicks:remove':     return nicks.remove(data?.userId);
    case 'nicks:reset':      return nicks.reset();

    case 'tops:resetDaily':   return tops.resetDailyManual();
    case 'tops:resetMonthly': return tops.resetMonthlyManual();
    case 'tops:checkMonthly': return tops.checkMonthlyReset() || { ok: true };

    case 'announcements:setEnabled':  return announcements.setEnabled(data?.enabled);
    case 'announcements:setInterval': return announcements.setIntervalMin(data?.minutes);
    case 'announcements:setGap':      return announcements.setMessagesGapMs(data?.ms);
    case 'announcements:add':         return announcements.addAnnouncement(data);
    case 'announcements:update':      return announcements.updateAnnouncement(data?.id, data?.patch || {});
    case 'announcements:remove':      return announcements.removeAnnouncement(data?.id);
    case 'announcements:sendNow':     return announcements.sendNow(data?.id);

    case 'donationBar:setGoal':  return donationBar.setGoal(data || {});
    case 'donationBar:resetBar': return donationBar.resetBar();

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
    dj: dj.getState(),
    nicks: nicks.getState(),
    tops: tops.getState(),
    announcements: announcements.getState(),
    donationBar: donationBar.getState(),
    wheelQueueSize: wheel.getQueueSize(),
  };
}

function handleChat(msg) {
  keyword.handleChat(msg);
  nicks.handleChat(msg);
}

module.exports = {
  initAll, handleCommand, getFullState, handleChat,
  tickets, donors, sniper, dj, nicks, wheel, tops, announcements, donationBar,
};
