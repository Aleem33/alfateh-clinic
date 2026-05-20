const { app, BrowserWindow, Menu, shell, ipcMain, screen } = require('electron');
const path = require('path');
const { initAutoUpdater, checkForUpdates, installUpdate } = require('./updater');

let mainWindow;

function getInitialWindowBounds() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const margin = 24;
  const availableWidth = Math.max(640, workAreaSize.width - margin);
  const availableHeight = Math.max(480, workAreaSize.height - margin);
  const width = Math.min(1440, availableWidth);
  const height = Math.min(900, availableHeight);

  return {
    width,
    height,
    minWidth: Math.min(1100, width),
    minHeight: Math.min(700, height),
  };
}

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const windowBounds = getInitialWindowBounds();

  mainWindow = new BrowserWindow({
    icon: iconPath,
    ...windowBounds,
    center: true,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
    title: 'Al-Fateh Clinic',
    show: false,
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function getMainWindow() {
  return mainWindow;
}

ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('updater:check', () => checkForUpdates());
ipcMain.handle('updater:install', () => installUpdate());
ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});
ipcMain.handle('window:toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});
ipcMain.handle('window:is-maximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false;
});

app.whenReady().then(() => {
  createWindow();
  initAutoUpdater(getMainWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('render-process-gone', (_event, _wc, details) => {
  if (details.reason !== 'clean-exit') {
    const message = 'The app window encountered an error and was reloaded.';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send('app:message', {
          type: 'error',
          title: 'App Reloaded',
          message,
        });
      });
      mainWindow.reload();
    }
  }
});
