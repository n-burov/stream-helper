// db.js
const fs = require('fs');
const path = require('path');

const isPkg = typeof process.pkg !== 'undefined';
const EXE_DIR = isPkg ? path.dirname(process.execPath) : __dirname;

// Если exe запущен из папки versions/ — используем data.json из родительской папки
let BASE_DIR = EXE_DIR;
if (path.basename(EXE_DIR).toLowerCase() === 'versions') {
  BASE_DIR = path.dirname(EXE_DIR);
}

const DATA_FILE = path.join(BASE_DIR, 'data.json');
const HISTORY_FILE = path.join(BASE_DIR, 'history.json');

const DEFAULT_DATA = {
  tokens: null,
  settings: {
    channel: null,
    ticketRewardId: null,
    ticketRewardTitle: null,
    donationAlertsToken: null,
    donationAlertsRefreshToken: null,
    donationAlertsExpiresAt: null,
  },
  follows: [],
  redemptions: [],

  tickets: {
    participants: [],
  },

  donors: {
    stream: {
      participants: [],
    },
    weekly: {
      participants: [],
      lastResetAt: null,
    },
  },

  nicks: {},

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

  dj: {
    rewardIds: [],
    scores: {},
    leader: null,
  },

  tops: {
    daily: { participants: [], lastResetAt: null },
    monthly: { participants: [], lastResetAt: null },
  },

  announcements: {
    enabled: false,
    intervalMin: 10,
    messagesGapMs: 500,
    list: [],
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

    // Мерж вложенных объектов
    dataCache.settings = { ...DEFAULT_DATA.settings, ...(raw.settings || {}) };
    dataCache.tickets = { ...DEFAULT_DATA.tickets, ...(raw.tickets || {}) };
    dataCache.donors = { ...DEFAULT_DATA.donors, ...(raw.donors || {}) };
    dataCache.dj = { ...DEFAULT_DATA.dj, ...(raw.dj || {}) };
    dataCache.tops = { ...DEFAULT_DATA.tops, ...(raw.tops || {}) };
    dataCache.announcements = { ...DEFAULT_DATA.announcements, ...(raw.announcements || {}) };

    if (!dataCache.announcements.list || dataCache.announcements.list.length === 0) {
      dataCache.announcements.list = [
        {
          id: 'default_roz',
          title: 'Розыгрыши',
          enabled: true,
          messages: [
            {
              type: 'announce',
              text: 'Пиши кодовое слово в чат, регистрируйся командой !ник и участвуй! Подробности о розыгрышах и призах в описании канала.',
              color: 'orange',
            },
          ],
        },
        {
          id: 'default_dj',
          title: 'Диджей дня',
          enabled: true,
          messages: [
            {
              type: 'announce',
              text: 'Стань DJ дня и получи 1 111 голды! Подробности о розыгрышах и призах - в описании канала.',
              color: 'orange',
            },
          ],
        },
        {
          id: 'default_links',
          title: 'Ссылки',
          enabled: true,
          messages: [
            { type: 'announce', text: 'Полезные ссылки:', color: 'orange' },
            { type: 'message', text: 'Подавай заявки в гильдию "The Best"' },
            { type: 'message', text: 'TG: t.me/+ATRh6Lw-nv0wMzJi' },
            { type: 'message', text: 'Discord: discord.gg/F8aYp6Y5a' },
            { type: 'message', text: 'Запись на рейды: guild-raid-time-sirus.vercel.app' },
          ],
        },
      ];
      saveData();
    }

    if (!dataCache.nicks || typeof dataCache.nicks !== 'object') {
      dataCache.nicks = {};
    }
    return dataCache;
  } catch {
    dataCache = JSON.parse(JSON.stringify(DEFAULT_DATA));
    return dataCache;
  }
}

function saveData() {
  if (!dataCache) return;
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dataCache, null, 2), 'utf8');
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
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
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
  BASE_DIR,
};
