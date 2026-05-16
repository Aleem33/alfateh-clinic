const { autoUpdater } = require('electron-updater');
const { app, dialog, BrowserWindow } = require('electron');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function sendStatus(win, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('updater:status', payload);
  }
}

function broadcastStatus(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    sendStatus(win, payload);
  }
}

function initAutoUpdater(getMainWindow) {
  if (!app.isPackaged) return;

  autoUpdater.on('checking-for-update', () => {
    broadcastStatus({ type: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    broadcastStatus({
      type: 'available',
      version: info.version,
      message: `Version ${info.version} is available. Downloading…`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    broadcastStatus({
      type: 'not-available',
      version: info.version,
      message: 'You are on the latest version.',
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcastStatus({
      type: 'download-progress',
      percent: Math.round(progress.percent),
      message: `Downloading update… ${Math.round(progress.percent)}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    broadcastStatus({
      type: 'downloaded',
      version: info.version,
      message: `Version ${info.version} is ready to install.`,
    });

    const win = getMainWindow();
    const parent = win && !win.isDestroyed() ? win : null;
    dialog
      .showMessageBox(parent, {
        type: 'info',
        title: 'Update Ready',
        message: `Al-Fateh Clinic ${info.version} has been downloaded.`,
        detail: 'Restart the app to apply the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall(false, true);
      });
  });

  autoUpdater.on('error', (err) => {
    broadcastStatus({
      type: 'error',
      message: err?.message || 'Update check failed.',
    });
  });

  // Check shortly after launch so the window can subscribe to events first.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 8000);
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    return { ok: false, message: 'Updates are only available in the installed app.' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err?.message || 'Update check failed.' };
  }
}

function installUpdate() {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall(false, true);
}

module.exports = { initAutoUpdater, checkForUpdates, installUpdate };
