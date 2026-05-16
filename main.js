const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { initAutoUpdater, checkForUpdates, installUpdate } = require('./updater');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
    title: 'Al-Fateh Clinic',
    icon: path.join(__dirname, 'icon.ico'),
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
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function getMainWindow() {
  return mainWindow;
}

ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('updater:check', () => checkForUpdates());
ipcMain.handle('updater:install', () => installUpdate());

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
    dialog.showErrorBox('Error', 'The app encountered an error. Please restart.');
    app.quit();
  }
});
