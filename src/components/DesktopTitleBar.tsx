import { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import logoUrl from '../assets/logo';

export function DesktopTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.isWindowMaximized().then(setMaximized).catch(() => {});
    return window.electronAPI.onWindowMaximizedChange(setMaximized);
  }, []);

  if (!window.electronAPI) return null;

  return (
    <div className="desktop-titlebar h-9 bg-[#0f2544] text-white flex items-center justify-between border-b border-white/10 select-none print:hidden">
      <div className="flex items-center gap-2 px-3 min-w-0">
        <img src={logoUrl} alt="" className="w-5 h-5 object-contain shrink-0" />
        <div className="text-sm font-medium truncate">Al-Fateh Clinic</div>
      </div>

      <div className="desktop-window-controls flex h-full">
        <button
          type="button"
          onClick={() => window.electronAPI?.minimizeWindow()}
          className="w-12 h-full inline-flex items-center justify-center text-white/75 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Minimize window"
          title="Minimize"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => window.electronAPI?.toggleMaximizeWindow()}
          className="w-12 h-full inline-flex items-center justify-center text-white/75 hover:text-white hover:bg-white/10 transition-colors"
          aria-label={maximized ? 'Restore window' : 'Maximize window'}
          title={maximized ? 'Restore' : 'Maximize'}
        >
          <Square className={`w-3.5 h-3.5 ${maximized ? 'scale-90' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => window.electronAPI?.closeWindow()}
          className="w-12 h-full inline-flex items-center justify-center text-white/75 hover:text-white hover:bg-red-600 transition-colors"
          aria-label="Close window"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
