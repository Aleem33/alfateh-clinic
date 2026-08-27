import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initializeTrustedClock } from './lib/trustedClock';

localStorage.removeItem('alfateh-theme');
document.documentElement.classList.remove('dark');

async function startApp() {
  // Electron's main process has already completed its initial trusted-server
  // time probe before loading this renderer. Hydrate that clock before any
  // screen can create a date-sensitive record.
  await initializeTrustedClock();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void startApp();
