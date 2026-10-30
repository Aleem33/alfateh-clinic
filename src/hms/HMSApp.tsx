import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Patients } from './pages/Patients';
import { Appointments } from './pages/Appointments';
import { OPD } from './pages/OPD';
import { IPD } from './pages/IPD';
import { Lab } from './pages/Lab';
import { Pharmacy } from './pages/Pharmacy';
import { Billing } from './pages/Billing';
import { Staff } from './pages/Staff';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { Suppliers } from './pages/Suppliers';
import { Expenses } from './pages/Expenses';
import { Prescriptions } from './pages/Prescriptions';
import { PrescriptionTemplates } from './pages/PrescriptionTemplates';
import { TokenDisplay } from './pages/TokenDisplay';
import { AuditLogs } from './pages/AuditLogs';
import { Schedule } from './pages/Schedule';
import { BedManagement } from './pages/BedManagement';
import { useAutoNotifications } from './lib/notifications';
import { SyncIssuesPage } from '../components/SyncIssuesPage';
import type { AuthSession } from '../lib/offlineAuth';
import { canAccessPage, roleHome } from '../lib/roleAccess';
import { RoleAccessDenied } from '../components/RoleAccessDenied';

interface Props {
  userRole: string | null;
  userEmail: string;
  onSwitchApp: (mode: 'hms' | 'pos') => void;
  onLoginSuccess: (session: AuthSession) => void;
  onBack?: () => void;
  onLogout?: () => void;
}

export function HMSApp({ userRole, userEmail, onSwitchApp, onLoginSuccess, onBack, onLogout }: Props) {
  useAutoNotifications();

  if (!userRole) return <Login onLoginSuccess={onLoginSuccess} onBack={onBack} />;

  const r = userRole;
  const isAdmin = r === 'admin';
  const allow = (path: string) => canAccessPage('hms', r, path);
  const defaultPath = roleHome('hms', r);
  if (!defaultPath) return <RoleAccessDenied onLogout={onLogout} />;

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout role={r} userEmail={userEmail} onSwitchApp={onSwitchApp} onLogout={onLogout} />}>
            {allow('/') && <Route index element={<Dashboard />} />}
            {allow('/patients') && <Route path="patients" element={<Patients canDelete={isAdmin} />} />}
            {allow('/appointments') && <Route path="appointments" element={<Appointments />} />}
            {allow('/opd') && <Route path="opd" element={<OPD />} />}
            {allow('/ipd') && <Route path="ipd" element={<IPD />} />}
            {allow('/token') && <Route path="token" element={<TokenDisplay />} />}
            {['admin','doctor'].includes(r)                         && <Route path="prescriptions"         element={<Prescriptions />} />}
            {['admin','doctor'].includes(r)                         && <Route path="prescription-templates" element={<PrescriptionTemplates />} />}
            {allow('/lab') && <Route path="lab" element={<Lab role={r} />} />}
            {['admin','pharmacist'].includes(r)                     && <Route path="pharmacy"              element={<Pharmacy canEditMedicines={isAdmin} canEditPurchases={isAdmin} />} />}
            {['admin','pharmacist'].includes(r)                     && <Route path="suppliers"             element={<Suppliers />} />}
            {allow('/billing') && <Route path="billing" element={<Billing />} />}
            {isAdmin && <Route path="staff"    element={<Staff />} />}
            {allow('/schedule') && <Route path="schedule" element={<Schedule />} />}
            {allow('/beds') && <Route path="beds" element={<BedManagement />} />}
            {allow('/expenses') && <Route path="expenses" element={<Expenses canDelete={isAdmin} />} />}
            {allow('/reports') && <Route path="reports" element={<Reports />} />}
            {isAdmin && <Route path="audit"    element={<AuditLogs />} />}
            {isAdmin && <Route path="sync-issues" element={<SyncIssuesPage />} />}
            {isAdmin && <Route path="settings" element={<Settings />} />}
            {!allow('/') && <Route index element={<Navigate to={defaultPath} replace />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
