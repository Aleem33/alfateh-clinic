import type { AuthSession } from './offlineAuth';

export function needsCloudSessionRestore(session: AuthSession | null, currentUid: string | null | undefined) {
  if (!session) return false;
  return session.mode !== 'online' || currentUid !== session.profile.uid;
}

export function shouldAnnounceCloudReady(networkWasDisabled: boolean, cloudAuthReady: boolean) {
  return networkWasDisabled || !cloudAuthReady;
}