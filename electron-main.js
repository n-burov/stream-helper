// electron-main.js
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

let mainWindow = null;
let serverProcess = null;

function startServer() {
  serverProcess = fork(path.join(__dirname, 'server.js'), [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ELECTRON_MODE: '1' },
  });

  serverProcess.stdout.on('data', (d) => log.info('[server]', d.toString().trim()));
  serverProcess.stderr.on('data', (d) => log.error('[server]', d.toString().trim()));
}

// ============================================================
//  КНОПКА «НА ГЛАВНУЮ» — внедряется на каждую страницу
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
        position: fixed;
        bottom: 16px;
        right: 16px;
        padding: 10px 18px;
        background: linear-gradient(135deg, #9146ff, #7a3bcb);
        color: #fff;
        font-family: 'Segoe UI', system-ui, sans-serif;
        font-size: 14px;
        font-weight: 700;
        border-radius: 10px;
        cursor: pointer;
        z-index: 2147483647;
        box-shadow: 0 6px 24px rgba(145, 70, 255, 0.5), 0 0 0 1px rgba(255,255,255,0.1) inset;
        user-select: none;
        transition: all 0.15s;
        letter-spacing: 0.3px;
      \`;
      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'translateY(-2px)';
        btn.style.boxShadow = '0 10px 30px rgba(145, 70, 255, 0.7), 0 0 0 1px rgba(255,255,255,0.15) inset';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translateY(0)';
        btn.style.boxShadow = '0 6px 24px rgba(145, 70, 255, 0.5), 0 0 0 1px rgba(255,255,255,0.1) inset';
      });
      btn.addEventListener('click', () => {
        // Передаём сигнал в main-процесс через location (простой трюк)
        window.location.href = 'http://localhost:3000/';
      });

      document.body.appendChild(btn);
    })();
  `;

  mainWindow.webContents.executeJavaScript(js).catch((err) => {
    log.warn('[injectHomeButton] error:', err.message);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
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

  // Внедряем кнопку после загрузки любой страницы
  mainWindow.webContents.on('did-finish-load', () => {
    injectHomeButton();
  });

  // Внедряем кнопку также при навигации внутри SPA (если будет)
  mainWindow.webContents.on('did-navigate', () => {
    injectHomeButton();
  });

  mainWindow.webContents.on('did-navigate-in-page', () => {
    injectHomeButton();
  });

  // Перехват OAuth-навигации — открываем в системном браузере
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const oauthDomains = [
      'accounts.google.com',
      'id.twitch.tv',
      'www.donationalerts.com',
      'donationalerts.com',
    ];

    const shouldOpenExternal = oauthDomains.some(domain => url.includes(domain));

    if (shouldOpenExternal) {
      event.preventDefault();
      log.info('[auth] opening external browser:', url);
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const oauthDomains = [
      'accounts.google.com',
      'id.twitch.tv',
      'www.donationalerts.com',
      'donationalerts.com',
    ];

    const shouldOpenExternal = oauthDomains.some(domain => url.includes(domain));

    if (shouldOpenExternal) {
      log.info('[auth] opening external browser (window.open):', url);
      shell.openExternal(url);
    } else {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function setupUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version);
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info.version);
  });
  autoUpdater.on('error', (err) => log.error('Update error:', err.message));

  autoUpdater.checkForUpdates();
}

app.whenReady().then(() => {
  startServer();
  createWindow();
  setupUpdater();
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
