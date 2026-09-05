import type { OfflineAuthProfile } from '../types/electron';
import { trustedNowISO } from './trustedClock';

export type AuthSession = {
  mode: 'online' | 'offline';
  profile: OfflineAuthProfile;
};

let activeSession: AuthSession | null = null;
let cloudAuthReady = true;
const listeners = new Set<(session: AuthSession | null) => void>();

export function normalizeOfflineUsername(username: string) {
  return username.trim().toLowerCase().replace(/\s+/g, '.');
}

export function profileFromUserDocument(uid: string, email: string, data: Record<string, any>): OfflineAuthProfile {
  const username = normalizeOfflineUsername(String(data.username || email.split('@')[0] || ''));
  return {
    uid,
    username,
    email,
    name: String(data.name || username),
    role: String(data.role || 'cashier'),
    app: String(data.app || ''),
    permissions: Array.isArray(data.permissions)
      ? data.permissions.map(String)
      : (data.permissions && typeof data.permissions === 'object' ? data.permissions : []),
    active: data.active !== false && data.disabled !== true && data.deleted !== true,
    profileUpdatedAt: String(data.updatedAt || trustedNowISO()),
  };
}

export function setActiveAuthSession(session: AuthSession | null) {
  activeSession = session;
  listeners.forEach(listener => listener(session));
}

export function getActiveAuthSession() {
  return activeSession;
}

export function setCloudAuthReady(ready: boolean) {
  cloudAuthReady = ready;
  if (ready && typeof window !== 'undefined') window.dispatchEvent(new Event('alfateh:auth-sync-ready'));
}

export function isCloudAuthReady() {
  return cloudAuthReady;
}

export function subscribeActiveAuthSession(listener: (session: AuthSession | null) => void) {
  listeners.add(listener);
  listener(activeSession);
  return () => { listeners.delete(listener); };
}

export async function enrollOfflineCredential(username: string, password: string, profile: OfflineAuthProfile) {
  if (!window.electronAPI) return false;
  const available = await window.electronAPI.isOfflineAuthAvailable();
  if (!available) return false;
  await window.electronAPI.enrollOfflineCredential({ username, password, profile });
  return true;
}

export async function renewActiveOfflineCredential(password: string) {
  const session = getActiveAuthSession();
  if (!session) return false;
  return enrollOfflineCredential(session.profile.username, password, session.profile);
}

export async function verifyOfflineCredential(username: string, password: string) {
  if (!window.electronAPI) return { ok: false, reason: 'not-enrolled' as const };
  return window.electronAPI.verifyOfflineCredential({ username, password });
}

export async function updateCachedAuthProfile(profile: OfflineAuthProfile) {
  return window.electronAPI?.updateOfflineAuthProfile(profile) || false;
}

export async function revokeOfflineCredential(username: string) {
  return window.electronAPI?.revokeOfflineCredential(username) || false;
}
