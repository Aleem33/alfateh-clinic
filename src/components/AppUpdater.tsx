import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import type { UpdateStatus } from '../types/electron';

interface Props {
  variant?: 'landing' | 'settings';
}

export function AppUpdater({ variant = 'landing' }: Props) {
  const isElectron = typeof window.electronAPI !== 'undefined';
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI!.getAppVersion().then(setVersion);
    return window.electronAPI!.onUpdateStatus(setStatus);
  }, [isElectron]);

  const handleCheck = useCallback(async () => {
    if (!isElectron) return;
    setChecking(true);
    setStatus({ type: 'checking', message: 'Checking for updates…' });
    const result = await window.electronAPI!.checkForUpdates();
    if (!result.ok && result.message) {
      setStatus({ type: 'error', message: result.message });
    }
    setChecking(false);
  }, [isElectron]);

  const handleInstall = () => {
    window.electronAPI?.installUpdate();
  };

  if (!isElectron) {
    if (variant === 'settings') {
      return (
        <p className="text-sm text-gray-500">
          Auto-updates are available in the installed Windows desktop app.
        </p>
      );
    }
    return null;
  }

  const showRestart = status?.type === 'downloaded';
  const showProgress = status?.type === 'download-progress';
  const isBusy = checking || status?.type === 'checking' || showProgress;

  if (variant === 'landing') {
    return (
      <div className="mt-6 w-full max-w-xl space-y-2">
        <p className="text-white/30 text-xs text-center">
          Al-Fateh Clinic Management System · v{version || '…'}
        </p>
        {(status || showRestart) && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-blue-100/90">
            <div className="flex items-start gap-2">
              {status?.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
              ) : showRestart ? (
                <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
              ) : (
                <Download className="w-4 h-4 shrink-0 text-blue-400 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p>{status?.message || 'Update ready.'}</p>
                {showProgress && status.percent != null && (
                  <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-blue-400 rounded-full transition-all"
                      style={{ width: `${status.percent}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              {showRestart ? (
                <button
                  onClick={handleInstall}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
                >
                  Restart to Update
                </button>
              ) : (
                <button
                  onClick={handleCheck}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 text-xs font-medium disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                  Check for updates
                </button>
              )}
            </div>
          </div>
        )}
        {!status && !showRestart && (
          <button
            onClick={handleCheck}
            disabled={isBusy}
            className="mx-auto flex items-center gap-1.5 text-white/25 hover:text-white/40 text-xs transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
            Check for updates
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Installed version: <span className="font-medium text-gray-800">v{version || '…'}</span>
      </p>
      {status && (
        <div
          className={`text-sm rounded-lg px-3 py-2 ${
            status.type === 'error'
              ? 'bg-amber-50 text-amber-800'
              : status.type === 'downloaded'
                ? 'bg-green-50 text-green-800'
                : 'bg-blue-50 text-blue-800'
          }`}
        >
          {status.message}
          {showProgress && status.percent != null && (
            <div className="mt-2 h-1.5 rounded-full bg-blue-200 overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all"
                style={{ width: `${status.percent}%` }}
              />
            </div>
          )}
        </div>
      )}
      <div className="flex gap-2">
        {showRestart ? (
          <button
            onClick={handleInstall}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Download className="w-4 h-4" /> Restart to Update
          </button>
        ) : (
          <button
            onClick={handleCheck}
            disabled={isBusy}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isBusy ? 'animate-spin' : ''}`} />
            {isBusy ? 'Checking…' : 'Check for Updates'}
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400">
        Updates are delivered from GitHub Releases. The app checks automatically on startup.
      </p>
    </div>
  );
}