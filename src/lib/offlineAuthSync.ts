import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { disableNetwork, doc, enableNetwork, getDocFromServer } from 'firebase/firestore';
import { auth, db, usernameToEmail } from '../firebase';
import {
  getActiveAuthSession,
  setCloudAuthReady,
  isCloudAuthReady,
  profileFromUserDocument,
  revokeOfflineCredential,
  setActiveAuthSession,
  updateCachedAuthProfile,
  type AuthSession,
} from './offlineAuth';
import { subscribeLanStatus } from './lanCoordinator';
import { needsCloudSessionRestore, shouldAnnounceCloudReady } from './offlineAuthDecision';

type Hooks = {
  onSession?: (session: AuthSession) => void;
  onRevoked?: (message: string) => void;
  onSyncError?: (message: string) => void;
};

let started = false;
let firestoreNetworkDisabled = false;
let reconnecting = false;

async function keepFirestoreOffline() {
  setCloudAuthReady(false);
  if (firestoreNetworkDisabled) return;
  await disableNetwork(db);
  firestoreNetworkDisabled = true;
}

async function restoreFirestoreNetwork() {
  const shouldAnnounceReady = shouldAnnounceCloudReady(firestoreNetworkDisabled, isCloudAuthReady());
  if (firestoreNetworkDisabled) {
    await enableNetwork(db);
    firestoreNetworkDisabled = false;
  }
  if (shouldAnnounceReady) setCloudAuthReady(true);
}

async function revokeSession(session: AuthSession, hooks: Hooks, message: string) {
  await keepFirestoreOffline();
  await signOut(auth).catch(() => undefined);
  await revokeOfflineCredential(session.profile.username).catch(() => false);
  setActiveAuthSession(null);
  hooks.onRevoked?.(message);
}

async function reconnectAuthenticatedSession(hooks: Hooks) {
  if (reconnecting) return;
  const session = getActiveAuthSession();
  if (!session) {
    await restoreFirestoreNetwork();
    return;
  }
  if (!needsCloudSessionRestore(session, auth.currentUser?.uid)) {
    await restoreFirestoreNetwork();
    return;
  }
  reconnecting = true;
  try {
    await keepFirestoreOffline();
    const stored = await window.electronAPI?.getOfflineCloudCredential(session.profile.username);
    if (!stored || stored.uid !== session.profile.uid) {
      await revokeSession(session, hooks, 'Offline access for this account must be renewed with an online login.');
      return;
    }

    const credential = await signInWithEmailAndPassword(
      auth,
      usernameToEmail(stored.username),
      stored.password,
    );
    if (credential.user.uid !== session.profile.uid) {
      await revokeSession(session, hooks, 'The cached account identity no longer matches Firebase. Sign in online again.');
      return;
    }

    await restoreFirestoreNetwork();
    const snapshot = await getDocFromServer(doc(db, 'users', credential.user.uid));
    if (!snapshot.exists()) {
      await revokeSession(session, hooks, 'This account was removed by an administrator. Offline access has been revoked.');
      return;
    }
    const profile = profileFromUserDocument(
      credential.user.uid,
      credential.user.email || usernameToEmail(stored.username),
      snapshot.data(),
    );
    if (!profile.active) {
      await revokeSession(session, hooks, 'This account was disabled by an administrator. Offline access has been revoked.');
      return;
    }
    await updateCachedAuthProfile(profile);
    const refreshed: AuthSession = { mode: 'online', profile };
    setActiveAuthSession(refreshed);
    setCloudAuthReady(true);
    hooks.onSession?.(refreshed);
  } catch (error: any) {
    const code = String(error?.code || '');
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-disabled') || code.includes('user-not-found')) {
      if (session) await revokeSession(session, hooks, 'The account password or status changed. Sign in online again to renew offline access.');
    } else {
      await keepFirestoreOffline();
      hooks.onSyncError?.('Cloud login could not be verified yet. Queued data remains safely offline and will retry when connectivity stabilizes.');
    }
  } finally {
    reconnecting = false;
  }
}

export function startOfflineAuthSync(hooks: Hooks = {}) {
  if (started || typeof window === 'undefined') return;
  started = true;

  let cloudOnline = false;
  const handleStatus = (online: boolean) => {
    cloudOnline = online;
    if (!online) {
      void keepFirestoreOffline();
      return;
    }
    void reconnectAuthenticatedSession(hooks);
  };
  const retryCloudSession = () => {
    if (!cloudOnline) return;
    const session = getActiveAuthSession();
    if (needsCloudSessionRestore(session, auth.currentUser?.uid)) {
      void reconnectAuthenticatedSession(hooks);
    }
  };

  subscribeLanStatus(status => handleStatus(status.online));
  window.setInterval(retryCloudSession, 15_000);
  window.addEventListener('focus', retryCloudSession);
}
