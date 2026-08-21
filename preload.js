const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  getLanStatus: () => ipcRenderer.invoke('lan:get-status'),
  setLanConnectivity: (online) => ipcRenderer.invoke('lan:set-connectivity', online),
  acquireLanWriteAccess: () => ipcRenderer.invoke('lan:acquire-write'),
  publishLanActivity: (activity) => ipcRenderer.invoke('lan:publish-activity', activity),
  completeLanCloudSync: () => ipcRenderer.invoke('lan:complete-cloud-sync'),
  isOfflineAuthAvailable: () => ipcRenderer.invoke('offline-auth:available'),
  enrollOfflineCredential: (input) => ipcRenderer.invoke('offline-auth:enroll', input),
  verifyOfflineCredential: (input) => ipcRenderer.invoke('offline-auth:verify', input),
  getOfflineCloudCredential: (username) => ipcRenderer.invoke('offline-auth:get-cloud-credential', username),
  updateOfflineAuthProfile: (profile) => ipcRenderer.invoke('offline-auth:update-profile', profile),
  revokeOfflineCredential: (username) => ipcRenderer.invoke('offline-auth:revoke', username),
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
  onAppMessage: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('app:message', handler);
    return () => ipcRenderer.removeListener('app:message', handler);
  },
  onWindowMaximizedChange: (callback) => {
    const handler = (_event, maximized) => callback(maximized);
    ipcRenderer.on('window:maximized-changed', handler);
    return () => ipcRenderer.removeListener('window:maximized-changed', handler);
  },
  onLanStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('lan:status', handler);
    return () => ipcRenderer.removeListener('lan:status', handler);
  },
  onLanActivity: (callback) => {
    const handler = (_event, activity) => callback(activity);
    ipcRenderer.on('lan:activity', handler);
    return () => ipcRenderer.removeListener('lan:activity', handler);
  },
});
