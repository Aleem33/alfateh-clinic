import { useState } from 'react';
import logoUrl from '../../assets/logo';
import { Outlet, NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Pill, Users, Truck,
  BarChart3, Settings, LogOut, UserCog, History, Receipt,
  PackagePlus, RotateCcw, Menu, X, ClipboardList, ArrowLeftRight,
} from 'lucide-react';
import { logout } from '../../firebase';
import { cn } from '../lib/utils';

const allNavItems = [
  { to: '/',                 icon: LayoutDashboard, label: 'Dashboard',        roles: ['admin', 'pharmacist'] },
  { to: '/billing',          icon: ShoppingCart,    label: 'Billing',          roles: ['admin', 'cashier'] },
  { to: '/patient-history',  icon: ClipboardList,   label: 'Patient Rx',       roles: ['admin', 'pharmacist', 'cashier'] },
  { to: '/purchases',        icon: PackagePlus,     label: 'Purchases',        roles: ['admin', 'pharmacist'] },
  { to: '/purchase-returns', icon: RotateCcw,       label: 'Purchase Returns', roles: ['admin', 'pharmacist'] },
  { to: '/sales',            icon: History,         label: 'Sales History',    roles: ['admin', 'cashier', 'pharmacist'] },
  { to: '/sale-returns',     icon: RotateCcw,       label: 'Sale Returns',     roles: ['admin', 'cashier'] },
  { to: '/medicines',        icon: Pill,            label: 'Medicines',        roles: ['admin', 'pharmacist'] },
  { to: '/customers',        icon: Users,           label: 'Customers',        roles: ['admin'] },
  { to: '/suppliers',        icon: Truck,           label: 'Suppliers',        roles: ['admin', 'pharmacist'] },
  { to: '/expenses',         icon: Receipt,         label: 'Expenses',         roles: ['admin'] },
  { to: '/reports',          icon: BarChart3,       label: 'Reports',          roles: ['admin'] },
  { to: '/users',            icon: UserCog,         label: 'Users',            roles: ['admin'] },
  { to: '/settings',         icon: Settings,        label: 'Settings',         roles: ['admin'] },
];

interface Props {
  role: string;
  onSwitchApp: (mode: 'hms' | 'pos') => void;
  onLogout?: () => void;
}

export function Layout({ role, onSwitchApp, onLogout }: Props) {
  const navItems = allNavItems.filter(item => item.roles.includes(role));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const canSwitchToHospital = role === 'admin' || role === 'pharmacist';
  const handleLogout = onLogout || logout;

  const NavItems = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
            )
          }
        >
          <item.icon className="w-5 h-5 shrink-0" />
          {item.label}
        </NavLink>
      ))}
    </>
  );

  const FooterActions = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="space-y-1">
      {canSwitchToHospital && (
        <button
          onClick={() => {
            onNavigate?.();
            onSwitchApp('hms');
          }}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-md text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
        >
          <ArrowLeftRight className="w-5 h-5" />
          Switch to Hospital
        </button>
      )}
      <button
        onClick={handleLogout}
        className="flex items-center gap-3 px-3 py-2 w-full rounded-md text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
      >
        <LogOut className="w-5 h-5" />
        Logout
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex print:bg-white">
      <aside className="hidden md:flex w-64 bg-white border-r border-gray-200 flex-col print:hidden shrink-0">
        <div className="h-20 flex items-center px-4 border-b border-gray-200 bg-blue-600">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="Al-Fateh Pharmacy" className="w-10 h-10 object-contain shrink-0 rounded-full border-2 border-white bg-white shadow" />
            <div>
              <div className="text-white font-bold text-base leading-tight">Al-Fateh Pharmacy</div>
              <div className="text-blue-100 text-xs">POS System</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          <NavItems />
        </nav>
        <div className="p-4 border-t border-gray-200">
          <FooterActions />
        </div>
      </aside>

      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <aside
        className={cn(
          'md:hidden fixed top-0 left-0 h-full w-72 bg-white z-50 flex flex-col shadow-xl transition-transform duration-300 print:hidden',
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div
          className="flex items-center justify-between px-4 bg-blue-600 shrink-0"
          style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(56px + env(safe-area-inset-top))' }}
        >
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="Al-Fateh Pharmacy" className="w-8 h-8 object-contain rounded-full border-2 border-white bg-white shadow" />
            <div>
              <div className="text-white font-bold text-sm leading-tight">Al-Fateh Pharmacy</div>
              <div className="text-blue-100 text-xs">POS System</div>
            </div>
          </div>
          <button onClick={() => setDrawerOpen(false)} className="text-white/80 hover:text-white p-1" aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 py-3 px-3 space-y-1 overflow-y-auto">
          <NavItems onNavigate={() => setDrawerOpen(false)} />
        </nav>
        <div
          className="p-4 border-t border-gray-200 shrink-0"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
        >
          <FooterActions onNavigate={() => setDrawerOpen(false)} />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <header
          className="md:hidden flex items-center gap-3 px-4 bg-blue-600 text-white shrink-0 print:hidden"
          style={{ height: 'calc(56px + env(safe-area-inset-top))', paddingTop: 'env(safe-area-inset-top)' }}
        >
          <button onClick={() => setDrawerOpen(true)} className="p-1 -ml-1" aria-label="Open menu">
            <Menu className="w-6 h-6" />
          </button>
          <img src={logoUrl} alt="" className="w-7 h-7 object-contain rounded-full border border-white/50 bg-white" />
          <span className="font-semibold text-base">Al-Fateh Pharmacy POS</span>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6 print:p-0 print:overflow-visible">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
