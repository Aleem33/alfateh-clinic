import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Download, Info, X } from 'lucide-react';
import type { AppMessage, UpdateStatus } from '../types/electron';

type Notice = {
  id: number;
  kind: 'error' | 'info' | 'success' | 'update';
  title: string;
  message: string;
  version?: string;
  persistent?: boolean;
};

function iconFor(kind: Notice['kind']) {
  if (kind === 'error') return <AlertCircle className="w-5 h-5 text-red-500" />;
  if (kind === 'success') return <CheckCircle className="w-5 h-5 text-green-600" />;
  if (kind === 'update') return <Download className="w-5 h-5 text-blue-600" />;
  return <Info className="w-5 h-5 text-blue-600" />;
}

export function GlobalAppNotifications() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    if (!window.electronAPI) return;

    const pushNotice = (notice: Omit<Notice, 'id'>) => {
      const id = Date.now() + Math.random();
      setNotices(prev => [notice.persistent ? { ...notice, id } : { ...notice, id }, ...prev].slice(0, 3));
      if (!notice.persistent) {
        window.setTimeout(() => {
          setNotices(prev => prev.filter(item => item.id !== id));
        }, 6000);
      }
    };

    const offUpdate = window.electronAPI.onUpdateStatus((status: UpdateStatus) => {
      if (status.type === 'downloaded') {
        pushNotice({
          kind: 'update',
          title: `Update ${status.version || ''} Ready`.trim(),
          message: status.message || 'A new update has been downloaded. Restart to install it.',
          version: status.version,
          persistent: true,
        });
      }
      if (status.type === 'error') {
        pushNotice({
          kind: 'error',
          title: 'Update Error',
          message: status.message || 'Update check failed.',
        });
      }
    });

    const offMessage = window.electronAPI.onAppMessage((message: AppMessage) => {
      pushNotice({
        kind: message.type,
        title: message.title || (message.type === 'error' ? 'App Error' : 'Notice'),
        message: message.message,
        persistent: message.type === 'error',
      });
    });

    return () => {
      offUpdate();
      offMessage();
    };
  }, []);

  if (notices.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-[9999] w-[min(420px,calc(100vw-2rem))] space-y-3 print:hidden">
      {notices.map(notice => (
        <div key={notice.id} className="rounded-xl border border-gray-200 bg-white shadow-2xl shadow-gray-900/15 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">{iconFor(notice.kind)}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{notice.title}</p>
              <p className="text-sm text-gray-600 mt-1">{notice.message}</p>
              {notice.kind === 'update' && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => window.electronAPI?.installUpdate()}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
                  >
                    Restart Now
                  </button>
                  <button
                    onClick={() => setNotices(prev => prev.filter(item => item.id !== notice.id))}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50"
                  >
                    Later
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => setNotices(prev => prev.filter(item => item.id !== notice.id))}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
