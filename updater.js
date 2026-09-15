// updater.js
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');

const CURRENT_VERSION = require('./package.json').version;
const REPO = 'n-burov/stream-helper';

const isPkg = typeof process.pkg !== 'undefined';
const EXE_PATH = process.execPath;
const EXE_DIR = path.dirname(EXE_PATH);
const EXE_NAME = path.basename(EXE_PATH);
const NEW_EXE_PATH = EXE_PATH + '.new';
const VERSIONS_DIR = path.join(EXE_DIR, 'versions');
const UPDATE_BAT = path.join(EXE_DIR, 'update.bat');

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

// Скачивание файла с редиректами
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

// Создать bat для автообновления.
// Логика:
// 1. Ждём 2 секунды, чтобы exe освободился
// 2. Копируем текущий exe в versions/<имя>_v<версия>.exe
// 3. Копируем .new на место основного exe
// 4. Запускаем новую версию
// 5. Чистим старые версии, оставляя 5 последних
// 6. Самоудаление bat
function createUpdateBat() {
  if (!fs.existsSync(VERSIONS_DIR)) {
    fs.mkdirSync(VERSIONS_DIR, { recursive: true });
  }

  const baseName = EXE_NAME.replace(/\.exe$/i, '');
  const archivedName = `${baseName}_v${CURRENT_VERSION}.exe`;
  const ARCHIVED_PATH = path.join(VERSIONS_DIR, archivedName);

  const batContent = `@echo off
chcp 65001 > nul
timeout /t 2 /nobreak > nul

rem Сохраняем текущую версию в архив
copy /y "${EXE_PATH}" "${ARCHIVED_PATH}" > nul

rem Подменяем основной exe новой версией
copy /y "${NEW_EXE_PATH}" "${EXE_PATH}" > nul
del /q "${NEW_EXE_PATH}"

rem Запускаем новую версию
start "" "${EXE_PATH}"

rem Чистим старые версии (оставляем максимум 5 последних по дате изменения)
cd /d "${VERSIONS_DIR}"
for /f "skip=5 delims=" %%F in ('dir /b /o-d /a-d "*.exe" 2^>nul') do del /q "%%F"

rem Самоудаление
cd /d "${EXE_DIR}"
del /q "%~f0"
`;

  fs.writeFileSync(UPDATE_BAT, batContent, 'utf8');
  return archivedName;
}

// Основная функция проверки и автоустановки
async function checkForUpdate() {
  // 1. Если запущено из папки versions/ — не обновляемся.
  //    Это "безопасный режим": старая версия всегда остаётся рабочей.
  if (isPkg && path.basename(EXE_DIR).toLowerCase() === 'versions') {
    log('запущено из versions/, автообновление отключено');
    return { skipped: true, reason: 'in versions folder' };
  }

  // 2. В dev-режиме (npm start) автообновление не работает
  if (!isPkg) {
    log('dev-режим: автообновление отключено');
    return { skipped: true, reason: 'dev mode' };
  }

  // 3. Если есть .new с прошлого раза — значит предыдущий запуск упал до применения.
  //    Применяем сразу, не дожидаясь проверки GitHub.
  if (fs.existsSync(NEW_EXE_PATH)) {
    log('найден скачанный .new с прошлого раза, применяю...');
    try {
      createUpdateBat();
      exec(`start "" "${UPDATE_BAT}"`, { detached: true, stdio: 'ignore', windowsHide: true });
      setTimeout(() => process.exit(0), 500);
      return { applied: true };
    } catch (e) {
      log('не удалось применить .new:', e.message);
      try { fs.unlinkSync(NEW_EXE_PATH); } catch {}
    }
  }

  // 4. Проверяем GitHub на новую версию
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
      log('в релизе нет тега');
      return { error: 'нет тега в релизе' };
    }

    if (!isNewer(remoteVersion, CURRENT_VERSION)) {
      log(`обновлений нет (текущая ${CURRENT_VERSION}, последняя ${remoteVersion})`);
      return { upToDate: true, current: CURRENT_VERSION, remote: remoteVersion };
    }

    log(`найдено обновление ${remoteVersion} (текущая ${CURRENT_VERSION}), скачиваю...`);

    const asset = (release.assets || []).find(a => a.name === 'TwitchOverlay.exe');
    if (!asset) {
      log('в релизе нет ассета TwitchOverlay.exe');
      return { error: 'в релизе нет ассета TwitchOverlay.exe' };
    }

    await downloadFile(asset.browser_download_url, NEW_EXE_PATH, headers);

    log(`скачано ${(asset.size / 1024 / 1024).toFixed(1)} МБ, применяю...`);

    createUpdateBat();
    exec(`start "" "${UPDATE_BAT}"`, { detached: true, stdio: 'ignore', windowsHide: true });

    // Даём bat-скрипту стартовать и выходим
    setTimeout(() => process.exit(0), 500);

    return { updated: true, to: remoteVersion };
  } catch (e) {
    log('ошибка:', e.message);
    return { error: e.message };
  }
}

module.exports = { checkForUpdate, CURRENT_VERSION };
