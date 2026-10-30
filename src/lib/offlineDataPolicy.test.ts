import { describe, expect, it } from 'vitest';
import { canRoleReadOfflineCollection, getOfflineCollectionsForRole } from './offlineDataPolicy';

describe('offline data access policy', () => {
  it('allows administrators to mirror every configured collection', () => {
    expect(getOfflineCollectionsForRole('admin')).toContain('auditLogs');
    expect(getOfflineCollectionsForRole('admin')).toContain('users');
    expect(getOfflineCollectionsForRole('admin')).toContain('expenses');
  });

  it('does not expose admin-only or finance data to pharmacists', () => {
    expect(canRoleReadOfflineCollection('pharmacist', 'medicines')).toBe(true);
    expect(canRoleReadOfflineCollection('pharmacist', 'auditLogs')).toBe(false);
    expect(canRoleReadOfflineCollection('pharmacist', 'syncIssues')).toBe(false);
    expect(canRoleReadOfflineCollection('pharmacist', 'expenses')).toBe(false);
    expect(canRoleReadOfflineCollection('pharmacist', 'posExpenses')).toBe(true);
    expect(canRoleReadOfflineCollection('cashier', 'posExpenses')).toBe(false);
    expect(canRoleReadOfflineCollection('pharmacist', 'users')).toBe(false);
  });

  it('allows dispensing roles to read customer payments without exposing other finance records', () => {
    expect(canRoleReadOfflineCollection('cashier', 'customerPayments')).toBe(true);
    expect(canRoleReadOfflineCollection('pharmacist', 'customerPayments')).toBe(true);
    expect(canRoleReadOfflineCollection('doctor', 'customerPayments')).toBe(false);
  });

  it('rejects unconfigured roles rather than starting a misleading empty or unauthorized cache', () => {
    expect(getOfflineCollectionsForRole('unknown')).toEqual([]);
  });
});
