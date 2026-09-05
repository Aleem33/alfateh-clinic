import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, logout } from './firebase';
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
