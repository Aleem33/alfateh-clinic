import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, logout } from './firebase';
import { doc, getDoc } from '@/lib/firestore';
import { AppSelector } from './landing/AppSelector';
import { HMSApp } from './hms/HMSApp';
import { POSApp } from './pos/POSApp';
import { GlobalAppNotifications } from './components/GlobalAppNotifications';
import { AppDialogProvider } from './components/AppDialog';
import { DesktopTitleBar } from './components/DesktopTitleBar';
import { startOfflineSyncService } from './lib/offlineSync';
import { isCloudOnline, startLanCoordinator } from './lib/lanCoordinator';
import { startFullOfflineCache, stopFullOfflineCache } from './lib/offlineCache';
import {
  profileFromUserDocument,
  setActiveAuthSession,
  updateCachedAuthProfile,
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

  useEffect(() => {
    startLanCoordinator();
    startOfflineAuthSync({
      onSession: session => {
        setUserRole(session.profile.role);
        setUserEmail(session.profile.email);
        setUser({ uid: session.profile.uid, email: session.profile.email });
        localStorage.setItem('alfateh.cachedUserRole', session.profile.role);
      },
      onRevoked: message => {
        setAuthError(message);
        setSessionAuthed(false);
        setUserRole(null);
        setUserEmail('');
        setAppMode(null);
      },
      onSyncError: message => setAuthError(message),
    });
    startOfflineSyncService();
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setAuthError('');
      if (u) {
        startFullOfflineCache();
        setUserEmail(u.email || '');
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          if (!snap.exists()) {
            setAuthError('Your account has not been configured yet. Please contact your administrator.');
            await logout();
            setUserRole(null);
            setUserEmail('');
          } else {
            const profile = profileFromUserDocument(u.uid, u.email || '', snap.data());
            setUserRole(profile.role);
            localStorage.setItem('alfateh.cachedUserRole', profile.role);
            void updateCachedAuthProfile(profile);
          }
        } catch {
          if (!isCloudOnline()) {
            setAuthError('Using cached login. Some cloud-only actions will sync when internet returns.');
            setUserRole(localStorage.getItem('alfateh.cachedUserRole') || 'cashier');
          } else {
            setAuthError('Failed to load your account. Please try again.');
            await logout();
          }
        }
      } else {
        stopFullOfflineCache();
        setUserRole(null);
        setUserEmail('');
        setUser(null);
        // Only go back to selector if we're not in the middle of switching apps
        // (handleSwitchApp / handleSelectApp manage appMode themselves)
        setSessionAuthed(false);
        return;
      }
      setUser(u);
    });
    return () => unsub();
  }, []);

  // Called when user picks an app from the selector
  const handleSelectApp = async (mode: AppMode) => {
    setSessionAuthed(false);
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
    startFullOfflineCache();
    setActiveAuthSession(session);
    setUserRole(session.profile.role);
    setUserEmail(session.profile.email);
    setUser({ uid: session.profile.uid, email: session.profile.email });
    localStorage.setItem('alfateh.cachedUserRole', session.profile.role);
    setSessionAuthed(true);
  };

  // Called by the Switch App button inside HMS or POS
  const handleSwitchApp = async (targetMode: AppMode) => {
    if (isCloudOnline()) await logout();
    setActiveAuthSession(null);
    setSessionAuthed(false);
    setUserRole(null);
    setAppMode(targetMode);     // go straight to target app's login
  };

  // Plain logout — go all the way back to AppSelector
  const handleLogout = async () => {
    if (isCloudOnline()) await logout();
    setActiveAuthSession(null);
    setSessionAuthed(false);
    setUserRole(null);
    setAppMode(null);
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
    return withShell(<HMSApp
      userRole={userRole}
      userEmail={userEmail}
      onSwitchApp={handleSwitchApp}
      onLoginSuccess={handleLoginSuccess}
      onLogout={handleLogout}
    />);
  }
  return withShell(<POSApp
    userRole={userRole}
    onSwitchApp={handleSwitchApp}
    onLoginSuccess={handleLoginSuccess}
    onLogout={handleLogout}
  />);
}
