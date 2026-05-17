import logoUrl from '../../assets/logo';
import { useState, useEffect, useCallback } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, CalendarDays, Stethoscope, BedDouble,
  FlaskConical, Pill, Receipt, UserCog, BarChart3,
  Settings as SettingsIcon, LogOut, Truck, Sun, Moon,
  TrendingDown, ClipboardList, ChevronLeft, ChevronRight,
  Shield, CalendarCheck, Hotel, ArrowLeftRight, Monitor, BookOpen,
} from 'lucide-react';
import { logout } from '../../firebase';
import { cn } from '../lib/utils';
import { useTheme } from '../lib/theme';
import { TopNavbar } from './TopNavbar';

const NAV = [
  {
    group: 'Clinical',
    items: [
      { to: '/',                       icon: LayoutDashboard, label: 'Dashboard',         roles: ['admin','receptionist','doctor'] },
      { to: '/patients',               icon: Users,           label: 'Patients',           roles: ['admin','receptionist','doctor'] },
      { to: '/appointments',           icon: CalendarDays,    label: 'Appointments',       roles: ['admin','receptionist','doctor'] },
      { to: '/token',                  icon: Monitor,         label: 'Token Display',      roles: ['admin','receptionist','doctor'] },
      { to: '/opd',                    icon: Stethoscope,     label: 'OPD',                roles: ['admin','receptionist','doctor'] },
      { to: '/prescriptions',          icon: ClipboardList,   label: 'Prescriptions',      roles: ['admin','doctor'] },
      { to: '/prescription-templates', icon: BookOpen,        label: 'Rx Templates',       roles: ['admin','doctor'] },
      { to: '/ipd',                    icon: BedDouble,       label: 'IPD',                roles: ['admin','receptionist','doctor'] },
    ],
  },
  {
    group: 'Services',
    items: [
      { to: '/lab',       icon: FlaskConical, label: 'Laboratory', roles: ['admin','doctor','lab_technician'] },
      { to: '/pharmacy',  icon: Pill,         label: 'Pharmacy',   roles: ['admin','pharmacist'] },
      { to: '/suppliers', icon: Truck,        label: 'Suppliers',  roles: ['admin','pharmacist'] },
      { to: '/billing',   icon: Receipt,      label: 'Billing',    roles: ['admin','cashier'] },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/staff',    icon: UserCog,       label: 'Staff',      roles: ['admin'] },
      { to: '/schedule', icon: CalendarCheck, label: 'Schedules',  roles: ['admin'] },
      { to: '/beds',     icon: Hotel,         label: 'Bed Mgmt',   roles: ['admin'] },
      { to: '/expenses', icon: TrendingDown,  label: 'Expenses',   roles: ['admin'] },
      { to: '/reports',  icon: BarChart3,     label: 'Reports',    roles: ['admin'] },
      { to: '/audit',    icon: Shield,        label: 'Audit Logs', roles: ['admin'] },
      { to: '/settings', icon: SettingsIcon,  label: 'Settings',   roles: ['admin'] },
    ],
  },
];

interface Props {
  role: string;
  userEmail: string;
  onSwitchApp: (mode: 'hms' | 'pos') => void;
  onLogout?: () => void;
}

export function Layout({ role, userEmail, onSwitchApp, onLogout }: Props) {
  const { theme, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      // Don't fire when typing in input/textarea/select
      if (['INPUT','TEXTAREA','SELECT'].includes(tag)) return;

      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'p': e.preventDefault(); window.print(); break;
        }
      } else {
        switch (e.key) {
          case 'Escape': {
            // Close any open modal by dispatching a custom event
            document.dispatchEvent(new CustomEvent('closeModal'));
            break;
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  return (
    <div className={theme === 'dark' ? 'dark' : ''}>
      <div className="flex h-screen bg-slate-100 dark:bg-gray-900 overflow-hidden">

        {/* Sidebar */}
        <aside className={cn(
          'bg-[#0f2544] dark:bg-[#020817] flex flex-col shrink-0 print:hidden transition-all duration-300',
          collapsed ? 'w-16' : 'w-60'
        )}>
          {/* Logo */}
          <div className="flex items-center justify-between px-3 py-4 border-b border-white/10 h-14">
            {!collapsed && (
              <div className="flex items-center gap-2.5 min-w-0">
                <img src={logoUrl} alt="Al-Fateh Clinic" className="w-8 h-8 object-contain shrink-0" />
                <div className="min-w-0">
                  <div className="text-white font-semibold text-sm leading-tight truncate">Al-Fateh Clinic</div>
                  <div className="text-blue-300 text-xs truncate">Management System</div>
                </div>
              </div>
            )}
            {collapsed && (
              <img src={logoUrl} alt="Al-Fateh Clinic" className="w-8 h-8 object-contain mx-auto" />
            )}
            {!collapsed && (
              <button onClick={() => setCollapsed(true)}
                className="p-1.5 text-blue-300/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors shrink-0">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
          </div>

          {collapsed && (
            <button onClick={() => setCollapsed(false)}
              className="mx-auto mt-2 p-1.5 text-blue-300/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
            {NAV.map(({ group, items }) => {
              const visible = items.filter(i => i.roles.includes(role));
              if (!visible.length) return null;
              return (
                <div key={group}>
                  {!collapsed && (
                    <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-blue-300/60">
                      {group}
                    </p>
                  )}
                  <div className="space-y-0.5">
                    {visible.map(({ to, icon: Icon, label }) => (
                      <NavLink
                        key={to} to={to} end={to === '/'}
                        title={collapsed ? label : undefined}
                        className={({ isActive }) => cn(
                          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                          collapsed && 'justify-center px-2',
                          isActive
                            ? 'bg-blue-600 text-white'
                            : 'text-blue-100/70 hover:text-white hover:bg-white/10'
                        )}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        {!collapsed && label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Bottom actions */}
          <div className="p-2 border-t border-white/10 space-y-0.5">
            {/* Switch to Pharmacy POS */}
            {(role === 'admin' || role === 'pharmacist' || role === 'cashier') && (
              <button
                onClick={() => onSwitchApp('pos')}
                title={collapsed ? 'Switch to Pharmacy POS' : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200 transition-colors',
                  collapsed && 'justify-center px-2'
                )}
              >
                <ArrowLeftRight className="w-4 h-4" />
                {!collapsed && 'Pharmacy POS'}
              </button>
            )}
            <button onClick={toggle}
              title={collapsed ? (theme === 'dark' ? 'Light Mode' : 'Dark Mode') : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-blue-100/70 hover:text-white hover:bg-white/10 transition-colors',
                collapsed && 'justify-center px-2'
              )}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {!collapsed && (theme === 'dark' ? 'Light Mode' : 'Dark Mode')}
            </button>
            <button onClick={onLogout || logout}
              title={collapsed ? 'Logout' : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors',
                collapsed && 'justify-center px-2'
              )}
            >
              <LogOut className="w-4 h-4" />
              {!collapsed && 'Logout'}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <TopNavbar userEmail={userEmail} userRole={role} />
          <main className="flex-1 overflow-auto dark:bg-gray-900">
            <div className="p-6 print:p-0 fade-in">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
