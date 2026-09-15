// updater.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const CURRENT_VERSION = require('./package.json').version;
const REPO = 'n-burov/stream-helper';

const isPkg = typeof process.pkg !== 'undefined';
const EXE_PATH = process.execPath;
const EXE_DIR = path.dirname(EXE_PATH);
const NEW_EXE_PATH = EXE_PATH + '.new';

function log(...args) { console.log('[updater]', ...args); }

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function downloadFile(url, dest, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest, headers).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

function isNewer(remote, local) {
  const a = String(remote).split('.').map(Number);
  const b = String(local).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function checkForUpdate() {
  if (!isPkg) {
    log('dev-режим: автообновление отключено');
    return { skipped: true, reason: 'dev mode' };
  }

  // Если уже скачан .new — не перекачиваем
  if (fs.existsSync(NEW_EXE_PATH)) {
    log('.new уже скачан ранее, пропускаю загрузку');
    return { alreadyDownloaded: true };
  }

  try {
    const headers = {
      'User-Agent': 'TwitchOverlay-Updater',
      'Accept': 'application/vnd.github+json',
    };

    const res = await httpsGet(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      headers
    );

    if (res.status !== 200) {
      log('GitHub API:', res.status);
      return { error: `GitHub API: ${res.status}` };
    }

    const release = JSON.parse(res.body);
    const remoteVersion = String(release.tag_name || '').replace(/^v/, '');

    if (!remoteVersion) {
      return { error: 'нет тега в релизе' };
    }

    if (!isNewer(remoteVersion, CURRENT_VERSION)) {
      log(`обновлений нет (текущая ${CURRENT_VERSION}, последняя ${remoteVersion})`);
      return { upToDate: true };
    }

    log(`найдено обновление ${remoteVersion}, скачиваю...`);

    const asset = (release.assets || []).find(a => a.name === 'TwitchOverlay.exe');
    if (!asset) {
      return { error: 'нет ассета TwitchOverlay.exe' };
    }

    await downloadFile(asset.browser_download_url, NEW_EXE_PATH, headers);
    log(`скачано ${(asset.size / 1024 / 1024).toFixed(1)} МБ -> ${NEW_EXE_PATH}`);
    log(`обновление доступно: ${remoteVersion}. Закрой приложение и перезапусти — новая версия применится.`);

    return { downloaded: true, to: remoteVersion };
  } catch (e) {
    log('ошибка:', e.message);
    return { error: e.message };
  }
}

module.exports = { checkForUpdate, CURRENT_VERSION };
