import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  primary: { currentUser: null as any }, secondary: { name: 'secondary' },
  session: null as any, online: true, profile: { role: 'cashier', active: true } as any,
  signIn: vi.fn(), signOut: vi.fn(), create: vi.fn(), serverRead: vi.fn(), cacheRead: vi.fn(),
  enableNetwork: vi.fn(), enroll: vi.fn(), setSession: vi.fn(),
}));
vi.mock('firebase/app', () => ({ initializeApp: (_config: unknown, name?: string) => ({ name }) }));
vi.mock('firebase/auth', () => ({
  getAuth: (app: any) => app.name ? mocks.secondary : mocks.primary,
  signInWithEmailAndPassword: mocks.signIn, signOut: mocks.signOut,
  createUserWithEmailAndPassword: mocks.create,
  setPersistence: vi.fn().mockResolvedValue(undefined), browserLocalPersistence: {},
}));
vi.mock('./lib/firestore', () => ({
  initializeFirestore: () => ({}), doc: (...args: any[]) => args,
  getDoc: mocks.cacheRead, getDocFromServer: mocks.serverRead, enableNetwork: mocks.enableNetwork,
  setDoc: vi.fn(), updateDoc: vi.fn(), increment: vi.fn(), runTransaction: vi.fn(),
  persistentLocalCache: vi.fn(), persistentMultipleTabManager: vi.fn(),
}));
vi.mock('firebase/storage', () => ({ getStorage: () => ({}) }));
vi.mock('./lib/lanCoordinator', () => ({ isCloudOnline: () => mocks.online }));
vi.mock('./lib/offlineIdentity', () => ({ getNextLocalNumber: () => 'TEST-1' }));
vi.mock('./lib/offlineAuth', async importOriginal => {
  const actual = await importOriginal<typeof import('./lib/offlineAuth')>();
  return { ...actual, getActiveAuthSession: () => mocks.session,
    enrollOfflineCredential: mocks.enroll, setActiveAuthSession: mocks.setSession };
});
import { createUser, loginWithUsername } from './firebase';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.online = true;
  mocks.session = null;
  mocks.primary.currentUser = null;
  mocks.profile = { role: 'cashier', active: true };
  mocks.signIn.mockResolvedValue({ user: { uid: 'user-1', email: 'cashier@alfateh-clinic.internal' } });
  mocks.serverRead.mockImplementation(async () => ({ exists: () => true, data: () => mocks.profile }));
  mocks.signOut.mockResolvedValue(undefined);
  mocks.enableNetwork.mockResolvedValue(undefined);
  mocks.enroll.mockResolvedValue(true);
  mocks.create.mockResolvedValue({ user: { uid: 'new-user' } });
});

describe('authoritative login and safe staff registration', () => {
  it('re-enables cloud reads and enrolls only the current server role, never an old cached admin profile', async () => {
    mocks.cacheRead.mockResolvedValue({ exists: () => true, data: () => ({ role: 'admin' }) });
    const session = await loginWithUsername('CASHIER', 'test-only-password');
    expect(mocks.enableNetwork).toHaveBeenCalledOnce();
    expect(mocks.serverRead).toHaveBeenCalledOnce();
    expect(mocks.cacheRead).not.toHaveBeenCalled();
    expect(session.profile.role).toBe('cashier');
    expect(mocks.enroll).toHaveBeenCalledWith('cashier', 'test-only-password', expect.objectContaining({ role: 'cashier' }));
  });
  it.each([{ role: 'admin', active: false }, { role: 'admin', disabled: true }, { role: 'admin', deleted: true }, { role: 'unknown' }])('refuses login/enrollment for %j', async profile => {
    mocks.profile = profile;
    await expect(loginWithUsername('user', 'test-only-password')).rejects.toThrow('disabled');
    expect(mocks.enroll).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledWith(mocks.primary);
  });
  it('rechecks server authority before registering an account from a stale admin screen', async () => {
    mocks.session = { profile: { uid: 'admin-1', email: 'admin@example.test', role: 'admin' } };
    mocks.primary.currentUser = { uid: 'admin-1' };
    mocks.profile = { role: 'cashier', active: true };
    await expect(createUser('new.user', 'test-only-password')).rejects.toThrow('Administrator access');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('creates users on secondary Auth without logging out the administrator', async () => {
    mocks.session = { profile: { uid: 'admin-1', email: 'admin@example.test', role: 'admin' } };
    mocks.primary.currentUser = { uid: 'admin-1' };
    mocks.profile = { role: 'admin', active: true };
    await expect(createUser('New User', 'test-only-password')).resolves.toMatchObject({ user: { uid: 'new-user' } });
    expect(mocks.create).toHaveBeenCalledWith(mocks.secondary, 'new.user@alfateh-clinic.internal', 'test-only-password');
    expect(mocks.signOut).toHaveBeenCalledWith(mocks.secondary);
    expect(mocks.signOut).not.toHaveBeenCalledWith(mocks.primary);
    expect(mocks.primary.currentUser.uid).toBe('admin-1');
  });
  it('does not attempt online account creation offline or as a non-admin', async () => {
    mocks.online = false;
    await expect(createUser('new.user', 'test-only-password')).rejects.toThrow('online');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
