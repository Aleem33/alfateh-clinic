import React from 'react';
import { createRoot } from 'react-dom/client';
import { disableNetwork } from 'firebase/firestore';
import { db } from '../src/firebase';
import { POSApp } from '../src/pos/POSApp';
import { HMSApp } from '../src/hms/HMSApp';
import { AppDialogProvider } from '../src/components/AppDialog';
import { getOfflineCacheStatus, startFullOfflineCache } from '../src/lib/offlineCache';
import { setActiveAuthSession } from '../src/lib/offlineAuth';
import { canAccessPage, PAGE_ROLES, roleHome } from '../src/lib/roleAccess';
import '../src/index.css';

const role = new URLSearchParams(location.search).get('role') || 'admin';
let online = true;
Object.defineProperty(navigator, 'onLine', { get: () => online });
const failures: string[] = [];
window.addEventListener('unhandledrejection', event => failures.push(String(event.reason?.message || event.reason)));
window.addEventListener('error', event => failures.push(event.message));
window.print = () => undefined;
setActiveAuthSession({ mode: 'online', profile: {
  uid: `smoke-${role}`, username: 'smoke', email: 'smoke@example.invalid', name: `Smoke ${role}`,
  role, app: 'hms', permissions: [], active: true, profileUpdatedAt: new Date().toISOString(),
} });
startFullOfflineCache(role);
const root = createRoot(document.getElementById('root')!);
const waitFor = async (check: () => boolean, label: string) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (failures.length) throw new Error(failures.join(' | '));
    if (document.body.innerText.includes('Something went wrong')) throw new Error(document.body.innerText);
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Role ${role}: ${label}; ${document.body.innerText.slice(-1200)}`);
};
const headings: Record<string, string> = {
  '/': 'Dashboard', '/billing': 'Billing', '/patients': 'Patients', '/appointments': 'Appointments',
  '/opd': 'OPD', '/ipd': 'IPD', '/token': 'Token Display', '/prescriptions': 'Prescriptions',
  '/prescription-templates': 'Prescription Templates', '/lab': 'Laboratory', '/pharmacy': 'Pharmacy',
  '/suppliers': 'Suppliers', '/staff': 'Staff Management', '/schedule': 'Staff Schedules',
  '/beds': 'Bed Management', '/expenses': 'Expenses', '/reports': 'Reports', '/audit': 'Audit Logs',
  '/settings': 'Settings', '/sync-issues': 'Sync Issues', '/users': 'Users', '/medicines': 'Medicines', '/customers': 'Customers',
  '/purchases': 'Purchases', '/purchase-returns': 'Purchase Returns', '/sales': 'Sales History',
  '/sale-returns': 'Sale Returns', '/patient-history': 'Patient Prescription History',
};
(window as any).smoke = {
  async auditRolePages(offline: boolean) {
    await waitFor(() => { const status = getOfflineCacheStatus(); return status.totalCollections > 0 && status.readyCollections === status.totalCollections; }, 'complete permitted cache');
    if (offline) { online = false; await disableNetwork(db); }
    let pages = 0;
    for (const app of ['hms', 'pos'] as const) {
      root.render(<></>);
      await new Promise(resolve => setTimeout(resolve, 50));
      location.hash = '/';
      const props = { userRole: role, onSwitchApp: () => {}, onLoginSuccess: () => {} };
      root.render(<AppDialogProvider>{app === 'hms' ? <HMSApp {...props} userEmail="smoke@example.invalid" /> : <POSApp {...props} />}</AppDialogProvider>);
      if (!roleHome(app, role)) {
        await waitFor(() => document.body.innerText.includes('does not have access'), 'access denied without redirect loop');
        continue;
      }
      for (const path of Object.keys(PAGE_ROLES[app]).filter(path => canAccessPage(app, role, path))) {
        location.hash = path;
        const heading = app === 'pos' && path === '/billing' ? 'Current Sale' : headings[path];
        if (!heading) throw new Error(`Missing test heading for ${path}`);
        await waitFor(() => location.hash === `#${path}` && [...document.querySelectorAll('main h1, main h2')].some(node => node.textContent?.includes(heading)), `${app} ${path} renders`);
        // Let collection callbacks and effects run, not just the heading render.
        await new Promise(resolve => setTimeout(resolve, 100));
        pages++;
      }
      if (role !== 'admin') {
        location.hash = '/settings';
        await waitFor(() => location.hash === `#${roleHome(app, role)}`, 'unauthorized URL redirects to permitted home');
      }
    }
    if (failures.length) throw new Error(failures.join(' | '));
    return { role, offline, pages, failures };
  },
};
