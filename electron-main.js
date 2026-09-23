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
      if (document.getElementById('__electron_home_btn')) return;
      const btn = document.createElement('div');
      btn.id = '__electron_home_btn';
      btn.textContent = '← На главную';
      btn.style.cssText = \`
        position: fixed; bottom: 16px; right: 16px;
        padding: 10px 18px;
        background: linear-gradient(135deg, #9146ff, #7a3bcb);
        color: #fff; font-family: 'Segoe UI', system-ui, sans-serif;
        font-size: 14px; font-weight: 700; border-radius: 10px;
        cursor: pointer; z-index: 2147483647;
        box-shadow: 0 6px 24px rgba(145, 70, 255, 0.5);
        user-select: none;
      \`;
      btn.addEventListener('click', () => { window.location.href = 'http://localhost:3000/'; });
      document.body.appendChild(btn);
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

  // Перехват OAuth — открываем в системном браузере
  const oauthDomains = ['accounts.google.com', 'id.twitch.tv', 'www.donationalerts.com', 'donationalerts.com'];

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (oauthDomains.some(d => url.includes(d))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

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

  // Ставим disableWebInstaller — иначе апдейтер ругается в логах
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

  // Первая проверка при старте
  autoUpdater.checkForUpdates().catch((e) => {
    log.error('[update] check failed:', e.message);
    sendUpdateStatus({ state: 'error', error: e.message });
  });

  // Проверяем каждые 30 минут, пока приложение открыто
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

// ============================================================
//  ЛОГИ
// ============================================================
ipcMain.handle('get-logs', () => {
  try {
    const logFile = path.join(app.getPath('logs'), 'main.log');
    if (!fs.existsSync(logFile)) return { ok: true, content: '(лог пуст)' };

    const stat = fs.statSync(logFile);
    // Если файл больше 2 МБ — читаем последние 100 КБ
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
