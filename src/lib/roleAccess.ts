// Keep navigation and direct URL access on the same role policy.
export const SUPPORTED_ROLES = ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'cashier', 'accountant', 'lab_technician', 'lab'] as const;
const clinical = ['admin', 'doctor', 'nurse', 'receptionist'];
const pharmacy = ['admin', 'pharmacist'];
const dispensing = ['admin', 'pharmacist', 'cashier'];
export const PAGE_ROLES: Record<'hms' | 'pos', Record<string, readonly string[]>> = {
  pos: {
    '/': pharmacy, '/billing': dispensing, '/patient-history': dispensing,
    '/medicines': pharmacy, '/purchases': pharmacy, '/purchase-returns': pharmacy,
    '/suppliers': pharmacy, '/sales': dispensing, '/sale-returns': dispensing,
    '/customers': ['admin'], '/expenses': ['admin'], '/reports': ['admin'],
    '/users': ['admin'], '/settings': ['admin'], '/sync-issues': ['admin'],
  },
  hms: {
    '/': clinical, '/patients': clinical, '/appointments': clinical,
    '/opd': clinical, '/ipd': clinical, '/token': clinical,
    '/prescriptions': ['admin', 'doctor'], '/prescription-templates': ['admin', 'doctor'],
    '/lab': [...clinical, 'lab_technician', 'lab'], '/pharmacy': pharmacy, '/suppliers': pharmacy,
    '/billing': ['admin', 'cashier', 'accountant', 'receptionist'],
    '/expenses': ['admin', 'accountant'], '/reports': ['admin', 'accountant'],
    '/schedule': ['admin', 'receptionist'], '/beds': ['admin'],
    '/staff': ['admin'], '/audit': ['admin'], '/settings': ['admin'], '/sync-issues': ['admin'],
  },
};
export function isSupportedRole(role: string) {
  return (SUPPORTED_ROLES as readonly string[]).includes(role);
}
export function canAccessPage(app: 'hms' | 'pos', role: string, path: string) {
  return PAGE_ROLES[app][path]?.includes(role) === true;
}
export function roleHome(app: 'hms' | 'pos', role: string): string | null {
  if (!isSupportedRole(role)) return null;
  if (app === 'pos') return role === 'cashier' ? '/billing' : canAccessPage(app, role, '/') ? '/' : null;
  if (role === 'pharmacist') return '/pharmacy';
  if (role === 'lab' || role === 'lab_technician') return '/lab';
  if (role === 'cashier' || role === 'accountant') return '/billing';
  return canAccessPage(app, role, '/') ? '/' : null;
}
