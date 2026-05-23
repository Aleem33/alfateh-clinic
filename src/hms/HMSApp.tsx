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

interface Props {
  userRole: string | null;
  userEmail: string;
  onSwitchApp: (mode: 'hms' | 'pos') => void;
  onLoginSuccess: () => void;
  onBack?: () => void;
  onLogout?: () => void;
}

export function HMSApp({ userRole, userEmail, onSwitchApp, onLoginSuccess, onBack, onLogout }: Props) {
  useAutoNotifications();

  if (!userRole) return <Login onLoginSuccess={onLoginSuccess} onBack={onBack} />;

  const r = userRole;
  const isAdmin = r === 'admin';
  const clinical = ['admin', 'receptionist', 'doctor'];
  const defaultPath =
    r === 'pharmacist'     ? '/pharmacy' :
    r === 'lab_technician' ? '/lab'      :
    r === 'cashier'        ? '/billing'  : '/';

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout role={r} userEmail={userEmail} onSwitchApp={onSwitchApp} onLogout={onLogout} />}>
            {clinical.includes(r) && <Route index element={<Dashboard />} />}
            {clinical.includes(r) && <Route path="patients"     element={<Patients />} />}
            {clinical.includes(r) && <Route path="appointments" element={<Appointments />} />}
            {clinical.includes(r) && <Route path="opd"          element={<OPD />} />}
            {clinical.includes(r) && <Route path="ipd"          element={<IPD />} />}
            {clinical.includes(r) && <Route path="token"        element={<TokenDisplay />} />}
            {['admin','doctor'].includes(r)                         && <Route path="prescriptions"         element={<Prescriptions />} />}
            {['admin','doctor'].includes(r)                         && <Route path="prescription-templates" element={<PrescriptionTemplates />} />}
            {['admin','doctor','lab_technician'].includes(r)        && <Route path="lab"                   element={<Lab />} />}
            {['admin','pharmacist'].includes(r)                     && <Route path="pharmacy"              element={<Pharmacy />} />}
            {['admin','pharmacist'].includes(r)                     && <Route path="suppliers"             element={<Suppliers />} />}
            {['admin','cashier'].includes(r)                        && <Route path="billing"               element={<Billing />} />}
            {isAdmin && <Route path="staff"    element={<Staff />} />}
            {isAdmin && <Route path="schedule" element={<Schedule />} />}
            {isAdmin && <Route path="beds"     element={<BedManagement />} />}
            {isAdmin && <Route path="expenses" element={<Expenses />} />}
            {isAdmin && <Route path="reports"  element={<Reports />} />}
            {isAdmin && <Route path="audit"    element={<AuditLogs />} />}
            {isAdmin && <Route path="sync-issues" element={<SyncIssuesPage />} />}
            {isAdmin && <Route path="settings" element={<Settings />} />}
            {!clinical.includes(r) && <Route index element={<Navigate to={defaultPath} replace />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
