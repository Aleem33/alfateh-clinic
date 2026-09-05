import { GLOBAL_DATA_COLLECTIONS } from './dataCollections';

const ADMIN_ONLY_COLLECTIONS = new Set(['auditLogs', 'syncIssues']);
const FINANCE_COLLECTIONS = new Set(['expenses']);
const CUSTOMER_PAYMENT_ROLES = new Set(['admin', 'cashier']);
const FINANCE_ROLES = new Set(['admin', 'accountant', 'receptionist']);

export function canRoleReadOfflineCollection(role: string | null | undefined, collectionName: string) {
  if (!role) return false;
  if (role === 'admin') return true;
  if (collectionName === 'users') return false;
  if (ADMIN_ONLY_COLLECTIONS.has(collectionName)) return false;
  if (FINANCE_COLLECTIONS.has(collectionName)) return FINANCE_ROLES.has(role);
  if (collectionName === 'customerPayments') return CUSTOMER_PAYMENT_ROLES.has(role);
  return GLOBAL_DATA_COLLECTIONS.includes(collectionName);
}

export function getOfflineCollectionsForRole(role: string | null | undefined) {
  return GLOBAL_DATA_COLLECTIONS.filter(collectionName => canRoleReadOfflineCollection(role, collectionName));
}
