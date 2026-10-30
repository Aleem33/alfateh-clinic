import { describe, expect, it } from 'vitest';
import { canAccessPage, PAGE_ROLES, roleHome, SUPPORTED_ROLES } from './roleAccess';
import { getOfflineCollectionsForRole } from './offlineDataPolicy';

describe('role navigation and offline access', () => {
  it.each(SUPPORTED_ROLES)('provides a working hospital landing page and permitted cache for %s', role => {
    const home = roleHome('hms', role);
    expect(home).not.toBeNull();
    expect(canAccessPage('hms', role, home!)).toBe(true);
    expect(getOfflineCollectionsForRole(role)).toContain('medicines');
    expect(getOfflineCollectionsForRole(role)).toContain('patients');
  });
  it.each(SUPPORTED_ROLES.filter(role => role !== 'admin'))('keeps administration inaccessible to %s', role => {
    for (const app of ['pos', 'hms'] as const) {
      for (const page of ['/users', '/settings', '/staff', '/audit', '/sync-issues']) {
        expect(canAccessPage(app, role, page)).toBe(false);
      }
    }
    expect(getOfflineCollectionsForRole(role)).not.toContain('users');
    expect(getOfflineCollectionsForRole(role)).not.toContain('auditLogs');
  });
  it('permits pharmacist dispensing without granting medicine editing or administration routes', () => {
    expect(canAccessPage('pos', 'pharmacist', '/billing')).toBe(true);
    expect(canAccessPage('pos', 'pharmacist', '/sale-returns')).toBe(true);
    expect(canAccessPage('pos', 'cashier', '/purchases')).toBe(false);
  });
  it('gives accountant finance pages and nurse clinical pages, not inventory administration', () => {
    for (const page of ['/billing', '/expenses', '/reports']) expect(canAccessPage('hms', 'accountant', page)).toBe(true);
    for (const page of ['/patients', '/appointments', '/opd', '/ipd', '/lab']) expect(canAccessPage('hms', 'nurse', page)).toBe(true);
    expect(canAccessPage('hms', 'nurse', '/pharmacy')).toBe(false);
  });
  it('never redirects a role without POS access into a redirect loop', () => {
    expect(roleHome('pos', 'doctor')).toBeNull();
    expect(roleHome('hms', 'unknown')).toBeNull();
    expect(canAccessPage('pos', 'unknown', '/sales')).toBe(false);
  });
  it('keeps admin access to every configured page', () => {
    for (const app of ['pos', 'hms'] as const) for (const path of Object.keys(PAGE_ROLES[app])) {
      expect(canAccessPage(app, 'admin', path)).toBe(true);
    }
  });
});
