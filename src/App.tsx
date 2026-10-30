import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db, logout } from './firebase';
import { AppSelector } from './landing/AppSelector';
import { HMSApp } from './hms/HMSApp';
import { POSApp } from './pos/POSApp';
import { GlobalAppNotifications } from './components/GlobalAppNotifications';
import { AppDialogProvider } from './components/AppDialog';
import { DesktopTitleBar } from './components/DesktopTitleBar';
import { InitialSyncGate } from './components/InitialSyncGate';
import { startOfflineSyncService } from './lib/offlineSync';
import { isCloudOnline, startLanCoordinator } from './lib/lanCoordinator';
import { startFullOfflineCache, stopFullOfflineCache } from './lib/offlineCache';
import {
  getActiveAuthSession,
  setActiveAuthSession,
  subscribeActiveAuthSession,
  profileFromUserDocument,
  updateCachedAuthProfile,
  revokeOfflineCredential,
  type AuthSession,
} from './lib/offlineAuth';
import { startOfflineAuthSync } from './lib/offlineAuthSync';

type AppMode = 'hms' | 'pos' | null;

export default function App() {
  const [appMode, setAppMode]       = useState<AppMode>(null);
  const [user, setUser]             = useState<any>(undefined);   // undefined = still loading
  const [userRole, setUserRole]     = useState<string | null>(null);
  const [userEmail, setUserEmail]   = useState('');
  const [authError, setAuthError]   = useState('');

  // sessionAuthed: did the user explicitly log in during THIS app session?
  // Starts false every launch, so always shows AppSelector → Login → App.
  const [sessionAuthed, setSessionAuthed] = useState(false);

  // Observe the signed-in user's own profile, not the admin-only users list.
  // Server-only updates prevent a cached role from undoing an admin's change.
  useEffect(() => {
    const session = getActiveAuthSession();
    if (!sessionAuthed || !session || auth.currentUser?.uid !== session.profile.uid) return;
    const uid = session.profile.uid;
    return onSnapshot(doc(db, 'users', uid), { includeMetadataChanges: true }, snapshot => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const current = getActiveAuthSession();
      if (!current || current.profile.uid !== uid) return;
      const profile = snapshot.exists()
        ? profileFromUserDocument(uid, current.profile.email, snapshot.data()) : null;
      if (!profile?.active) {
        void revokeOfflineCredential(current.profile.username).catch(console.warn);
        setActiveAuthSession(null);
        setUser(null);
        setAppMode(null);
        setAuthError('This account was disabled or removed. Contact an administrator. Pending entries remain on this computer.');
        void logout().catch(console.warn);
        return;
      }
      // profileUpdatedAt is generated for legacy records; compare actual access
      // fields so a harmless metadata snapshot never restarts the whole cache.
      const changed = ['role', 'name', 'email', 'username', 'app', 'active', 'permissions']
        .some(key => JSON.stringify(profile[key as keyof typeof profile]) !== JSON.stringify(current.profile[key as keyof typeof profile]));
      if (!changed) return;
      void updateCachedAuthProfile(profile).catch(console.warn);
      setActiveAuthSession({ ...current, profile });
    }, error => setAuthError(`Account permissions could not be refreshed: ${error.message}`));
  }, [sessionAuthed, user?.uid, userRole]);

  useEffect(() => subscribeActiveAuthSession(session => {
    if (session) {
      localStorage.setItem('alfateh.cachedUserRole', session.profile.role);
      startFullOfflineCache(session.profile.role);
      setUserRole(session.profile.role);
      setUserEmail(session.profile.email);
      setUser({ uid: session.profile.uid, email: session.profile.email });
    } else {
      stopFullOfflineCache();
      localStorage.removeItem('alfateh.cachedUserRole');
      setUserRole(null);
      setUserEmail('');
      setSessionAuthed(false);
    }
  }), []);

  useEffect(() => {
    startLanCoordinator();
    startOfflineAuthSync({
      onSession: () => setAuthError(''),
      onRevoked: message => {
        setActiveAuthSession(null);
        setAuthError(message);
        setUser(null);
        setAppMode(null);
      },
      onSyncError: message => setAuthError(message),
    });
    startOfflineSyncService();
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      const session = getActiveAuthSession();
      // Login validates the profile; the verified local session owns permissions.
      // Firebase may temporarily sign out while an offline account reconnects.
      if (session?.mode === 'offline') return;
      if (!u && session) setActiveAuthSession(null);
      if (!getActiveAuthSession()) setUser(u);
    });
    return () => {
      unsub();
      stopFullOfflineCache();
    };
  }, []);

  // Called when user picks an app from the selector
  const handleSelectApp = async (mode: AppMode) => {
    setActiveAuthSession(null);
    setAppMode(mode);
    // Sign out any persisted Firebase session silently (don't let
    // onAuthStateChanged reset appMode — we set it right after)
    if (auth.currentUser && isCloudOnline()) {
      await logout();
      // Re-set appMode in case onAuthStateChanged reset it to null
      setAppMode(mode);
    }
  };

  // Called by HMS / POS login page after successful Firebase login
  const handleLoginSuccess = (session: AuthSession) => {
    setActiveAuthSession(session);
    setAuthError('');
    setSessionAuthed(true);
  };

  // Called by the Switch App button inside HMS or POS
  const handleSwitchApp = async (targetMode: AppMode) => {
    setActiveAuthSession(null);
    setAppMode(targetMode);     // go straight to target app's login
    if (isCloudOnline()) await logout();
  };

  // Plain logout — go all the way back to AppSelector
  const handleLogout = async () => {
    setActiveAuthSession(null);
    setAppMode(null);
    if (isCloudOnline()) await logout();
  };

  // ── Loading (Firebase resolving persisted auth) ─────────────────────────────
  const withShell = (node: ReactNode) => (
    <AppDialogProvider>
      <GlobalAppNotifications />
      {window.electronAPI ? (
        <div className="electron-app-shell h-screen overflow-hidden bg-slate-100">
          <DesktopTitleBar />
          <div className="electron-app-content overflow-hidden">
            {node}
          </div>
        </div>
      ) : node}
    </AppDialogProvider>
  );

  if (user === undefined) {
    return (
      withShell(<div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-medium">Loading Al-Fateh Clinic...</p>
        </div>
      </div>)
    );
  }

  // ── Step 1: App Selection ───────────────────────────────────────────────────
  if (!appMode) {
    return withShell(<AppSelector onSelect={handleSelectApp} authError={authError} />);
  }

  // ── Step 2: Login for selected app (sessionAuthed not yet set) ─────────────
  if (!sessionAuthed) {
    if (appMode === 'hms') {
      return withShell(<HMSApp
        userRole={null}
        userEmail=""
        onSwitchApp={handleSwitchApp}
        onLoginSuccess={handleLoginSuccess}
        onBack={() => setAppMode(null)}
      />);
    }
    return withShell(<POSApp
      userRole={null}
      onSwitchApp={handleSwitchApp}
      onLoginSuccess={handleLoginSuccess}
      onBack={() => setAppMode(null)}
    />);
  }

  // ── Step 3: Inside the app ──────────────────────────────────────────────────
  if (appMode === 'hms') {
    return withShell(<InitialSyncGate key={`${user?.uid}:${userRole}`} onLogout={handleLogout}><HMSApp
      userRole={userRole}
      userEmail={userEmail}
      onSwitchApp={handleSwitchApp}
      onLoginSuccess={handleLoginSuccess}
      onLogout={handleLogout}
    /></InitialSyncGate>);
  }
  return withShell(<InitialSyncGate key={`${user?.uid}:${userRole}`} onLogout={handleLogout}><POSApp
    userRole={userRole}
    onSwitchApp={handleSwitchApp}
    onLoginSuccess={handleLoginSuccess}
    onLogout={handleLogout}
  /></InitialSyncGate>);
}
