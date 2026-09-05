const { app, BrowserWindow, session } = require('electron');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'alfateh-renderer-smoke-')));
app.commandLine.appendSwitch('disable-gpu');
const url = process.argv[2];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const createDevice = async (name, offline = false) => {
  const deviceSession = session.fromPartition(`persist:${name}`);
  deviceSession.webRequest.onBeforeRequest((details, done) => {
    const allowed = /^(https?|wss?):\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(details.url) || /^(data|blob):/.test(details.url);
    done({ cancel: !allowed });
  });
  const window = new BrowserWindow({ show: false, width: 1500, height: 1000, webPreferences: { session: deviceSession, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.log(`[${name}] ${message}`); });
  const deviceUrl = new URL(url);
  if (offline) deviceUrl.searchParams.set('offline', '1');
  await window.loadURL(deviceUrl.href);
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await window.webContents.executeJavaScript('Boolean(window.smoke)')) return window;
    await delay(100);
  }
  throw new Error('Renderer did not initialize');
};
app.whenReady().then(async () => {
  try {
    let primary = await createDevice('primary');
    const replica = await createDevice('replica');
    const first = await primary.webContents.executeJavaScript('window.smoke.primary()');
    primary.destroy();
    primary = await createDevice('primary', true);
    const reconnected = await primary.webContents.executeJavaScript('window.smoke.reconnectAfterOfflineRestart()');
    const second = await replica.webContents.executeJavaScript('window.smoke.verifyReplica()');
    const reloaded = new Promise(resolve => primary.webContents.once('did-finish-load', resolve));
    primary.reload();
    await reloaded;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (await primary.webContents.executeJavaScript('Boolean(window.smoke)')) break;
      await delay(100);
    }
    const restarted = await primary.webContents.executeJavaScript('window.smoke.verifyReplica()');
    console.log('RENDERER_SMOKE_PASS', JSON.stringify({ first, reconnected, second, restarted }));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
