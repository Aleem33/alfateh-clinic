import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

type DialogKind = 'alert' | 'confirm';

type DialogState = {
  kind: DialogKind;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'info';
  resolve: (value: boolean) => void;
};

type DialogApi = {
  alert: (message: string, title?: string) => Promise<void>;
  confirm: (message: string, options?: {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'danger' | 'info';
  }) => Promise<boolean>;
};

const AppDialogContext = createContext<DialogApi | null>(null);

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const close = useCallback((value: boolean) => {
    setDialog(current => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const alert = useCallback((message: string, title = 'Notice') => {
    return new Promise<void>(resolve => {
      setDialog({
        kind: 'alert',
        title,
        message,
        confirmLabel: 'OK',
        tone: 'info',
        resolve: () => resolve(),
      });
    });
  }, []);

  const confirm = useCallback<DialogApi['confirm']>((message, options) => {
    return new Promise<boolean>(resolve => {
      setDialog({
        kind: 'confirm',
        title: options?.title || 'Confirm Action',
        message,
        confirmLabel: options?.confirmLabel || 'Confirm',
        cancelLabel: options?.cancelLabel || 'Cancel',
        tone: options?.tone || 'danger',
        resolve,
      });
    });
  }, []);

  return (
    <AppDialogContext.Provider value={{ alert, confirm }}>
      {children}
      {dialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4 print:hidden">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
            <div className="flex items-start gap-3 p-5 border-b border-gray-100">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${dialog.tone === 'danger' ? 'bg-red-50' : 'bg-blue-50'}`}>
                {dialog.tone === 'danger'
                  ? <AlertTriangle className="w-5 h-5 text-red-600" />
                  : <Info className="w-5 h-5 text-blue-600" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-gray-900">{dialog.title}</h2>
                <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{dialog.message}</p>
              </div>
              <button
                onClick={() => close(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex gap-3 p-4">
              {dialog.kind === 'confirm' && (
                <button
                  onClick={() => close(false)}
                  className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  {dialog.cancelLabel}
                </button>
              )}
              <button
                onClick={() => close(true)}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-white ${dialog.tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppDialogContext.Provider>
  );
}

export function useAppDialog() {
  const context = useContext(AppDialogContext);
  if (!context) throw new Error('useAppDialog must be used inside AppDialogProvider');
  return context;
}
