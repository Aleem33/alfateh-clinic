import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Billing } from './pages/Billing';
import { Medicines } from './pages/Medicines';
import { Customers } from './pages/Customers';
import { Suppliers } from './pages/Suppliers';
import { Reports } from './pages/Reports';
import { Users } from './pages/Users';
import { SalesHistory } from './pages/SalesHistory';
import { Expenses } from './pages/Expenses';
import { Settings } from './pages/Settings';
import { Purchases } from './pages/Purchases';
import { SalesReturns } from './pages/SalesReturns';
import { PurchaseReturns } from './pages/PurchaseReturns';
import { PatientHistory } from './pages/PatientHistory';

interface Props {
  userRole: string | null;
  onSwitchApp: (mode: 'hms' | 'pos') => void;
  onLoginSuccess: () => void;
  onBack?: () => void;
  onLogout?: () => void;
}

export function POSApp({ userRole, onSwitchApp, onLoginSuccess, onBack, onLogout }: Props) {
  if (!userRole) return <Login onLoginSuccess={onLoginSuccess} onBack={onBack} />;

  const r = userRole;
  const isAdmin = r === 'admin';

  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout role={r} onSwitchApp={onSwitchApp} onLogout={onLogout} />}>
            {(isAdmin || r === 'pharmacist') && <Route index element={<Dashboard />} />}
            {(isAdmin || r === 'cashier')    && <Route path="billing"          element={<Billing />} />}
            {(isAdmin || r === 'pharmacist') && <Route path="medicines"        element={<Medicines />} />}
            {(isAdmin || r === 'pharmacist') && <Route path="purchases"        element={<Purchases />} />}
            {(isAdmin || r === 'pharmacist') && <Route path="purchase-returns" element={<PurchaseReturns />} />}
                                                 <Route path="sales"           element={<SalesHistory />} />
            {(isAdmin || r === 'cashier')    && <Route path="sale-returns"     element={<SalesReturns />} />}
            {isAdmin                         && <Route path="customers"        element={<Customers />} />}
            {(isAdmin || r === 'pharmacist') && <Route path="suppliers"        element={<Suppliers />} />}
            {isAdmin                         && <Route path="expenses"         element={<Expenses />} />}
            {isAdmin                         && <Route path="reports"          element={<Reports />} />}
            {isAdmin                         && <Route path="users"            element={<Users />} />}
            {isAdmin                         && <Route path="settings"         element={<Settings />} />}
            {(isAdmin || r === 'pharmacist' || r === 'cashier') && <Route path="patient-history" element={<PatientHistory />} />}

            {r === 'cashier'    && <Route index element={<Navigate to="/billing" replace />} />}
            {r === 'pharmacist' && <Route index element={<Navigate to="/medicines" replace />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
