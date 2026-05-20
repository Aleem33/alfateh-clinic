export type UpdateStatusType =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'download-progress'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  type: UpdateStatusType;
  version?: string;
  percent?: number;
  message?: string;
}

export interface AppMessage {
  type: 'error' | 'info' | 'success';
  title?: string;
  message: string;
}

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ ok: boolean; message?: string }>;
  installUpdate: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  onAppMessage: (callback: (message: AppMessage) => void) => () => void;
  onWindowMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
