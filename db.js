// db.js
const fs = require('fs');
const path = require('path');

const isPkg = typeof process.pkg !== 'undefined';
const BASE_DIR = isPkg ? path.dirname(process.execPath) : __dirname;

const DATA_FILE = path.join(BASE_DIR, 'data.json');
const HISTORY_FILE = path.join(BASE_DIR, 'history.json');

const DEFAULT_DATA = {
  tokens: null,
  settings: {
    channel: null,
    donatePayToken: null,
    ticketRewardId: null,        // ID награды «Билет на розыгрыш» (если null — ловим все награды)
	ticketRewardTitle: null,
  },
  follows: [],
  redemptions: [],

  // === Билеты на розыгрыш (снайпер по воскресеньям) ===
  tickets: {
    participants: [],            // [{ userId, username, redeemedAt }]
  },

  // === Донатеры (розыгрыш среди тех, кто задонатил за неделю) ===
  donors: {
    participants: [],
    resetAt: null,     // timestamp последнего ручного сброса
  },

  // === Механики ===
  keyword: {
    status: 'idle',
    word: 'Голда',
    participants: [],
    winners: [],
  },
  wheel: {
    sectors: [],
    currentRotation: 0,
    isSpinning: false,
    lastSpinId: null,
    winner: null,
  },
  sniper: {
    status: 'idle',
    participants: [],
    victimId: null,
    winnerName: null,
    nextId: 1,
  },
};

let dataCache = null;

function loadData() {
  if (dataCache) return dataCache;
  if (!fs.existsSync(DATA_FILE)) {
    dataCache = JSON.parse(JSON.stringify(DEFAULT_DATA));
    saveData();
    return dataCache;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    dataCache = { ...DEFAULT_DATA, ...raw };
    // Мержим вложенные объекты, чтобы новые поля появлялись у старых data.json
    dataCache.settings = { ...DEFAULT_DATA.settings, ...(raw.settings || {}) };
    dataCache.tickets = { ...DEFAULT_DATA.tickets, ...(raw.tickets || {}) };
    dataCache.donors = { ...DEFAULT_DATA.donors, ...(raw.donors || {}) };
    return dataCache;
  } catch {
    dataCache = JSON.parse(JSON.stringify(DEFAULT_DATA));
    return dataCache;
  }
}

function saveData() {
  if (!dataCache) return;
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dataCache, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function update(mutator) {
  const d = loadData();
  mutator(d);
  saveData();
  return d;
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); }
  catch { return []; }
}

function saveHistory(list) {
  const tmp = HISTORY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, HISTORY_FILE);
}

function addHistoryEntry(entry) {
  const list = loadHistory();
  list.unshift(entry);
  if (list.length > 200) list.length = 200;
  saveHistory(list);
  return list;
}

function clearHistory() { saveHistory([]); }

module.exports = {
  loadData, saveData, update,
  loadHistory, saveHistory, addHistoryEntry, clearHistory,
};
