const { autoUpdater }         = require('electron-updater');
const { app, BrowserWindow } = require('electron');
const path  = require('path');
const fs    = require('fs');

// ── Logging ────────────────────────────────────────────────────────────────────
const logFile = path.join(app.getPath('userData'), 'updater.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch {}
  console.log('[updater]', msg);
}

// ── IPC broadcast ──────────────────────────────────────────────────────────────
function broadcast(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updater:status', payload);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────
function initAutoUpdater(getMainWindow) {
  if (!app.isPackaged) {
    log('Running in dev — auto-update disabled');
    return;
  }

  autoUpdater.logger          = { info: log, warn: log, error: log, debug: () => {} };
  autoUpdater.autoDownload    = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log('Checking for update…');
    broadcast({ type: 'checking', message: 'Checking for updates…' });
  });

  autoUpdater.on('update-available', (info) => {
    log(`Update available: v${info.version}`);
    broadcast({
      type: 'available',
      version: info.version,
      message: `Version ${info.version} is available — downloading…`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    log(`Up to date: v${info.version}`);
    broadcast({
      type: 'not-available',
      version: info.version,
      message: 'You are on the latest version.',
    });
  });

  autoUpdater.on('download-progress', (p) => {
    const pct = Math.round(p.percent);
    log(`Download progress: ${pct}%`);
    broadcast({
      type: 'download-progress',
      percent: pct,
      message: `Downloading update… ${pct}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log(`Update downloaded: v${info.version}`);
    broadcast({
      type: 'downloaded',
      version: info.version,
      message: `Version ${info.version} downloaded — ready to install.`,
    });

  });

  autoUpdater.on('error', (err) => {
    log(`Update error: ${err?.message || err}`);
    broadcast({
      type:    'error',
      message: err?.message || 'Update check failed.',
    });
  });

  // Check 10 s after launch (lets the window fully render and subscribe first)
  setTimeout(() => {
    log('Starting initial update check…');
    autoUpdater.checkForUpdates().catch((e) => log(`Check error: ${e.message}`));
  }, 10_000);
}

// ── IPC handlers ───────────────────────────────────────────────────────────────
async function checkForUpdates() {
  if (!app.isPackaged) {
    return { ok: false, message: 'Updates only work in the installed app, not during development.' };
  }
  try {
    log('Manual update check triggered');
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    log(`Manual check error: ${err?.message}`);
    return { ok: false, message: err?.message || 'Update check failed.' };
  }
}

function installUpdate() {
  if (!app.isPackaged) return;
  log('Installing update and restarting…');
  autoUpdater.quitAndInstall(false, true);
}

module.exports = { initAutoUpdater, checkForUpdates, installUpdate };
