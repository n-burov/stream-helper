const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const fs = require('fs');

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

let mainWindow = null;

// ============================================================
//  СЕРВЕР (в-process, не fork)
// ============================================================
function startServer() {
  try {
    require('./server.js');
    log.info('[server] started in-process');
  } catch (e) {
    log.error('[server] failed:', e.message);
    log.error(e.stack);
  }
}

// ============================================================
//  КНОПКА «НА ГЛАВНУЮ»
// ============================================================
function injectHomeButton() {
  if (!mainWindow) return;
  const js = `
    (function() {
      // Не создаём повторно
      if (document.getElementById('__electron_toolbar')) return;

      // Контейнер с двумя кнопками
      const toolbar = document.createElement('div');
      toolbar.id = '__electron_toolbar';
      toolbar.style.cssText = \`
        position: fixed; bottom: 16px; right: 16px;
        display: flex; gap: 8px;
        z-index: 2147483647;
        user-select: none;
      \`;

      // Кнопка «Обновить»
      const reloadBtn = document.createElement('div');
      reloadBtn.id = '__electron_reload_btn';
      reloadBtn.textContent = '🔄 Обновить';
      reloadBtn.title = 'Перезагрузить страницу (F5)';
      reloadBtn.style.cssText = \`
        padding: 10px 18px;
        background: linear-gradient(135deg, #00d4ff, #0099cc);
        color: #fff;
        font-family: 'Segoe UI', system-ui, sans-serif;
        font-size: 14px; font-weight: 700; border-radius: 10px;
        cursor: pointer;
        box-shadow: 0 6px 24px rgba(0, 212, 255, 0.5);
      \`;
      reloadBtn.addEventListener('click', () => {
        window.location.reload();
      });

      // Кнопка «На главную»
      const homeBtn = document.createElement('div');
      homeBtn.id = '__electron_home_btn';
      homeBtn.textContent = '← На главную';
      homeBtn.style.cssText = \`
        padding: 10px 18px;
        background: linear-gradient(135deg, #9146ff, #7a3bcb);
        color: #fff;
        font-family: 'Segoe UI', system-ui, sans-serif;
        font-size: 14px; font-weight: 700; border-radius: 10px;
        cursor: pointer;
        box-shadow: 0 6px 24px rgba(145, 70, 255, 0.5);
      \`;
      homeBtn.addEventListener('click', () => {
        window.location.href = 'http://localhost:3000/';
      });

      toolbar.appendChild(reloadBtn);
      toolbar.appendChild(homeBtn);
      document.body.appendChild(toolbar);

      // ============================================================
      //  АВТО-ВОССТАНОВЛЕНИЕ ПРИ JS-ОШИБКАХ
      // ============================================================
      // Если где-то падает JS, через 3 секунды страница автоматически
      // перезагружается. Защита от «мёртвых» полей ввода.
      // Не срабатывает, если ошибка произошла в течение 5 секунд
      // после загрузки (защита от цикла).
      if (!window.__autoReloadInstalled) {
        window.__autoReloadInstalled = true;

        let lastErrorAt = 0;

        window.addEventListener('error', (event) => {
          // Игнорируем ошибки, не связанные с рендером UI
          // (например, WebSocket-редирект при реконнекте)
          const msg = String(event.message || '');

          // Не перезагружаем при "Script error." (кросс-доменные) и
          // при ошибках сети
          if (msg === 'Script error.') return;
          if (/WebSocket|Failed to fetch|NetworkError/i.test(msg)) return;

          const now = Date.now();

          // Защита от цикла: если ошибка повторилась быстрее 5 сек — не перезагружаем
          if (now - lastErrorAt < 5000) {
            console.warn('[auto-reload] ошибка повторилась, не перезагружаю:', msg);
            return;
          }
          lastErrorAt = now;

          console.error('[auto-reload] JS-ошибка, перезагрузка через 3 сек:', msg);

          // Показываем уведомление
          const notice = document.createElement('div');
          notice.style.cssText = \`
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            padding: 12px 24px;
            background: rgba(255,71,87,0.95);
            color: #fff;
            font-family: 'Segoe UI', system-ui, sans-serif;
            font-size: 14px; font-weight: 600; border-radius: 10px;
            box-shadow: 0 6px 24px rgba(255,71,87,0.5);
            z-index: 2147483647;
          \`;
          notice.textContent = '⚠️ Ошибка в интерфейсе, перезагружаю через 3 сек...';
          document.body.appendChild(notice);

          setTimeout(() => {
            window.location.reload();
          }, 3000);
        });

        // Также ловим необработанные Promise-реджекты
        window.addEventListener('unhandledrejection', (event) => {
          const reason = String(event.reason?.message || event.reason || '');
          if (/WebSocket|Failed to fetch|NetworkError/i.test(reason)) return;

          const now = Date.now();
          if (now - lastErrorAt < 5000) return;
          lastErrorAt = now;

          console.error('[auto-reload] Promise rejection, перезагрузка через 3 сек:', reason);

          setTimeout(() => {
            window.location.reload();
          }, 3000);
        });
      }
    })();
  `;
  mainWindow.webContents.executeJavaScript(js).catch(() => {});
}

// ============================================================
//  ОКНО
// ============================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const tryLoad = (attempt = 0) => {
    mainWindow.loadURL('http://localhost:3000').catch(() => {
      if (attempt < 40) setTimeout(() => tryLoad(attempt + 1), 500);
    });
  };
  tryLoad();

  mainWindow.webContents.on('did-finish-load', () => injectHomeButton());
  mainWindow.webContents.on('did-navigate', () => injectHomeButton());

  // ============================================================
  //  OAuth — открываем в системном браузере
  // ============================================================
  const OAUTH_PATHS = ['/auth/login', '/auth/callback', '/auth/donationalerts/login', '/auth/donationalerts/callback'];
  const OAUTH_DOMAINS = ['id.twitch.tv', 'www.donationalerts.com', 'donationalerts.com'];

  // 1) Перехват навигации на /auth/* и внешние OAuth-домены
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url);

      // Локальные /auth/* — открываем в браузере
      if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
          OAUTH_PATHS.some(p => u.pathname.startsWith(p))) {
        event.preventDefault();
        shell.openExternal(url);
        return;
      }

      // Внешние OAuth-домены — тоже в браузер
      if (OAUTH_DOMAINS.some(d => u.hostname.includes(d))) {
        event.preventDefault();
        shell.openExternal(url);
        return;
      }
    } catch {}
  });

  // 2) Перехват редиректов (на случай, если сервер сам редиректит на OAuth)
  mainWindow.webContents.on('will-redirect', (event, url) => {
    try {
      const u = new URL(url);
      if (OAUTH_DOMAINS.some(d => u.hostname.includes(d))) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {}
  });

  // 3) Любые window.open / target=_blank — в системный браузер
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ============================================================
//  АВТООБНОВЛЕНИЕ
// ============================================================
function sendUpdateStatus(payload) {
  if (mainWindow) mainWindow.webContents.send('update-status', payload);
}

function setupUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('[update] checking...');
    sendUpdateStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    log.info('[update] available:', info.version);
    sendUpdateStatus({
      state: 'available',
      version: info.version,
      releaseName: info.releaseName || '',
      releaseNotes: info.releaseNotes || '',
      releaseDate: info.releaseDate || '',
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('[update] not available');
    sendUpdateStatus({
      state: 'up-to-date',
      version: info?.version || app.getVersion(),
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      state: 'downloading',
      percent: Math.round(progress.percent || 0),
      bytesPerSecond: progress.bytesPerSecond || 0,
      transferred: progress.transferred || 0,
      total: progress.total || 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[update] downloaded:', info.version);
    sendUpdateStatus({
      state: 'downloaded',
      version: info.version,
      releaseNotes: info.releaseNotes || '',
    });
  });

  autoUpdater.on('error', (err) => {
    log.error('[update] error:', err.message);
    sendUpdateStatus({ state: 'error', error: err.message });
  });

  autoUpdater.checkForUpdates().catch((e) => {
    log.error('[update] check failed:', e.message);
    sendUpdateStatus({ state: 'error', error: e.message });
  });

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 30 * 60 * 1000);
}

// ============================================================
//  IPC для renderer
// ============================================================
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, version: result?.updateInfo?.version || app.getVersion() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('open-releases-page', () => {
  shell.openExternal('https://github.com/n-burov/stream-helper/releases');
});

ipcMain.handle('open-logs-folder', () => {
  shell.openPath(app.getPath('logs'));
});

// Открыть внешний URL в системном браузере (для кнопок авторизации)
ipcMain.handle('open-external', (event, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    shell.openExternal(url);
    return { ok: true };
  }
  return { ok: false, error: 'Invalid URL' };
});

// ============================================================
//  ЛОГИ
// ============================================================
ipcMain.handle('get-logs', () => {
  try {
    const logFile = path.join(app.getPath('logs'), 'main.log');
    if (!fs.existsSync(logFile)) return { ok: true, content: '(лог пуст)' };

    const stat = fs.statSync(logFile);
    const MAX_SIZE = 2 * 1024 * 1024;
    let content;
    if (stat.size > MAX_SIZE) {
      const fd = fs.openSync(logFile, 'r');
      const buffer = Buffer.alloc(100 * 1024);
      fs.readSync(fd, buffer, 0, buffer.length, stat.size - buffer.length);
      fs.closeSync(fd);
      content = '...(показаны последние 100 КБ)...\n\n' + buffer.toString('utf8');
    } else {
      content = fs.readFileSync(logFile, 'utf8');
    }
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('clear-logs', () => {
  try {
    const logFile = path.join(app.getPath('logs'), 'main.log');
    if (fs.existsSync(logFile)) fs.writeFileSync(logFile, '');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ============================================================
//  ЖИЗНЕННЫЙ ЦИКЛ
// ============================================================
app.whenReady().then(() => {
  startServer();
  createWindow();
  setupUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
