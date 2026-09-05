import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from './offlineAuth';

const mocks = vi.hoisted(() => ({
  session: null as AuthSession | null,
  auth: { currentUser: null as { uid: string; email?: string } | null },
  status: null as ((status: { online: boolean }) => void) | null,
  signIn: vi.fn(),
  signOut: vi.fn(),
  getCredential: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  revoke: vi.fn(),
  disableNetwork: vi.fn(),
  enableNetwork: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: mocks.signIn,
  signOut: mocks.signOut,
}));
vi.mock('firebase/firestore', () => ({
  disableNetwork: mocks.disableNetwork,
  enableNetwork: mocks.enableNetwork,
  doc: vi.fn(),
  getDocFromServer: mocks.getProfile,
}));
vi.mock('../firebase', () => ({
  auth: mocks.auth,
  db: {},
  usernameToEmail: (username: string) => `${username}@example.test`,
}));
vi.mock('./lanCoordinator', () => ({
  subscribeLanStatus: (listener: typeof mocks.status) => { mocks.status = listener; },
}));
vi.mock('./offlineAuth', () => ({
  getActiveAuthSession: () => mocks.session,
  setActiveAuthSession: (session: AuthSession | null) => { mocks.session = session; },
  setCloudAuthReady: vi.fn(),
  isCloudAuthReady: () => false,
  profileFromUserDocument: (uid: string, email: string, data: object) => ({ uid, email, ...data }),
  updateCachedAuthProfile: mocks.updateProfile,
  revokeOfflineCredential: mocks.revoke,
}));

function offlineSession(uid = 'account-a', role = 'admin'): AuthSession {
  return {
    mode: 'offline',
    profile: { uid, username: uid, email: `${uid}@example.test`, name: uid, role, app: 'pos', permissions: [], active: true, profileUpdatedAt: '' },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function beginReconnect() {
  const hooks = { onSession: vi.fn(), onRevoked: vi.fn(), onSyncError: vi.fn() };
  const { startOfflineAuthSync } = await import('./offlineAuthSync');
  startOfflineAuthSync(hooks);
  mocks.status?.({ online: true });
  return hooks;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.session = offlineSession();
  mocks.auth.currentUser = null;
  mocks.status = null;
  mocks.getCredential.mockResolvedValue({ uid: 'account-a', username: 'account-a', password: 'test-only' });
  mocks.signIn.mockImplementation(async () => {
    const user = { uid: 'account-a', email: 'account-a@example.test' };
    mocks.auth.currentUser = user;
    return { user };
  });
  mocks.signOut.mockImplementation(async () => { mocks.auth.currentUser = null; });
  mocks.disableNetwork.mockResolvedValue(undefined);
  mocks.enableNetwork.mockResolvedValue(undefined);
  mocks.updateProfile.mockResolvedValue(true);
  mocks.revoke.mockResolvedValue(true);
  mocks.getProfile.mockResolvedValue({ exists: () => true, data: () => offlineSession('account-a', 'cashier').profile });
  vi.stubGlobal('window', {
    electronAPI: { getOfflineCloudCredential: mocks.getCredential },
    setInterval: vi.fn(),
    addEventListener: vi.fn(),
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('offline account reconnect ownership', () => {
  it('applies the server-confirmed role to the same active session', async () => {
    const hooks = await beginReconnect();
    await vi.waitFor(() => expect(hooks.onSession).toHaveBeenCalledOnce());
    expect(mocks.session).toMatchObject({ mode: 'online', profile: { uid: 'account-a', role: 'cashier' } });
  });

  it('does not sign in if the user logs out while the local credential is loading', async () => {
    const credential = deferred<any>();
    mocks.getCredential.mockReturnValue(credential.promise);
    const hooks = await beginReconnect();
    await vi.waitFor(() => expect(mocks.getCredential).toHaveBeenCalledOnce());
    mocks.session = null;
    credential.resolve({ uid: 'account-a', username: 'account-a', password: 'test-only' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(hooks.onSession).not.toHaveBeenCalled();
  });

  it('discards a cloud login that completes after logout', async () => {
    const login = deferred<any>();
    mocks.signIn.mockReturnValue(login.promise);
    const hooks = await beginReconnect();
    await vi.waitFor(() => expect(mocks.signIn).toHaveBeenCalledOnce());
    mocks.session = null;
    const user = { uid: 'account-a', email: 'account-a@example.test' };
    mocks.auth.currentUser = user;
    login.resolve({ user });
    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(mocks.session).toBeNull();
    expect(mocks.getProfile).not.toHaveBeenCalled();
    expect(hooks.onSession).not.toHaveBeenCalled();
  });

  it('does not apply an old account profile after a different user logs in', async () => {
    const profile = deferred<any>();
    mocks.getProfile.mockReturnValue(profile.promise);
    const hooks = await beginReconnect();
    await vi.waitFor(() => expect(mocks.getProfile).toHaveBeenCalledOnce());
    const replacement = offlineSession('account-b', 'cashier');
    mocks.session = replacement;
    profile.resolve({ exists: () => true, data: () => offlineSession().profile });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.session).toBe(replacement);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(hooks.onSession).not.toHaveBeenCalled();
  });
});
