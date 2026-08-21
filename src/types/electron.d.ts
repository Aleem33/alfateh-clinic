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

export type LanRole = 'online' | 'ready' | 'candidate' | 'primary' | 'viewer' | 'syncing-primary' | 'sync-wait';

export interface LanActivity {
  id: string;
  action: string;
  collection: string;
  recordId?: string;
  label?: string;
  summary?: string;
  createdAt: string;
  deviceName?: string;
}

export interface LanStatus {
  deviceId: string;
  deviceName: string;
  online: boolean;
  role: LanRole;
  primary: { deviceId: string; deviceName: string } | null;
  peers: Array<{ deviceId: string; deviceName: string; role: string; lastSeen: number }>;
  activities: LanActivity[];
}

export interface OfflineAuthProfile {
  uid: string;
  username: string;
  email: string;
  name: string;
  role: string;
  app: string;
  permissions: string[] | Record<string, unknown>;
  active: boolean;
  profileUpdatedAt: string;
}

export interface OfflineAuthResult {
  ok: boolean;
  reason?: 'not-enrolled' | 'invalid-credential' | 'disabled' | 'locked';
  retryAfterSeconds?: number;
  profile?: OfflineAuthProfile;
}

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ ok: boolean; message?: string }>;
  installUpdate: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  getLanStatus: () => Promise<LanStatus | undefined>;
  setLanConnectivity: (online: boolean) => Promise<LanStatus | undefined>;
  acquireLanWriteAccess: () => Promise<{ allowed: boolean; reason?: string; status?: LanStatus } | undefined>;
  publishLanActivity: (activity: Partial<LanActivity>) => Promise<boolean | undefined>;
  completeLanCloudSync: () => Promise<LanStatus | undefined>;
  isOfflineAuthAvailable: () => Promise<boolean>;
  enrollOfflineCredential: (input: { username: string; password: string; profile: OfflineAuthProfile }) => Promise<OfflineAuthProfile>;
  verifyOfflineCredential: (input: { username: string; password: string }) => Promise<OfflineAuthResult>;
  getOfflineCloudCredential: (username: string) => Promise<{ username: string; password: string; uid: string } | null>;
  updateOfflineAuthProfile: (profile: OfflineAuthProfile) => Promise<boolean>;
  revokeOfflineCredential: (username: string) => Promise<boolean>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  onAppMessage: (callback: (message: AppMessage) => void) => () => void;
  onWindowMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  onLanStatus: (callback: (status: LanStatus) => void) => () => void;
  onLanActivity: (callback: (activity: LanActivity) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
