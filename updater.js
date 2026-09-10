// updater.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const CURRENT_VERSION = require('./package.json').version;
const REPO = 'n-burov/stream-helper';
const isPkg = typeof process.pkg !== 'undefined';
const EXE_PATH = process.execPath;
const EXE_DIR = path.dirname(EXE_PATH);

function log(...args) { console.log('[updater]', ...args); }

// Простой GET с редиректами
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

// Скачать файл с редиректами
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

// Сравнение версий: '1.2.10' > '1.2.9'
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

// Основная функция проверки
async function checkForUpdate({ silent = false } = {}) {
  // В dev-режиме (npm start) ничего не делаем
  if (!isPkg) {
    if (!silent) log('dev-режим: автообновление отключено');
    return { skipped: true, reason: 'dev mode' };
  }

  // Если есть .new с прошлого раза — значит предыдущий апдейт уже скачан, применяем
  const newExePath = EXE_PATH + '.new';
  if (fs.existsSync(newExePath)) {
    try {
      fs.copyFileSync(newExePath, EXE_PATH);
      fs.unlinkSync(newExePath);
      log('обновление применено, нужен перезапуск');
      return { applied: true, restartRequired: true };
    } catch (e) {
      log('не удалось применить обновление:', e.message);
    }
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
      log('не удалось получить релиз:', res.status);
      return { error: `GitHub API: ${res.status}` };
    }

    const release = JSON.parse(res.body);
    const remoteVersion = String(release.tag_name || '').replace(/^v/, '');

    if (!remoteVersion) {
      return { error: 'нет тега в релизе' };
    }

    if (!isNewer(remoteVersion, CURRENT_VERSION)) {
      if (!silent) log(`обновлений нет (текущая ${CURRENT_VERSION}, последняя ${remoteVersion})`);
      return { upToDate: true, current: CURRENT_VERSION, remote: remoteVersion };
    }

    // Находим ассет TwitchOverlay.exe
    const asset = (release.assets || []).find(a => a.name === 'TwitchOverlay.exe');
    if (!asset) {
      return { error: 'в релизе нет TwitchOverlay.exe' };
    }

    log(`скачиваю ${remoteVersion} (${(asset.size / 1024 / 1024).toFixed(1)} МБ)...`);

    await downloadFile(asset.browser_download_url, newExePath, headers);

    log('скачано. Обновление применится при следующем запуске.');

    // Пробуем применить сразу — если exe не заблокирован
    try {
      fs.copyFileSync(newExePath, EXE_PATH);
      fs.unlinkSync(newExePath);
      log('обновление применено');
      return {
        updated: true,
        restartRequired: true,
        from: CURRENT_VERSION,
        to: remoteVersion,
      };
    } catch (e) {
      // Windows не даст перезаписать запущенный exe — это нормально
      log('не удалось применить на лету:', e.message);
      return {
        downloaded: true,
        from: CURRENT_VERSION,
        to: remoteVersion,
        restartRequired: true,
      };
    }
  } catch (e) {
    log('ошибка:', e.message);
    return { error: e.message };
  }
}

module.exports = { checkForUpdate, CURRENT_VERSION };
