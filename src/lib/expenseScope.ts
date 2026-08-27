export type ExpenseScope = 'pharmacy' | 'hms';

const HMS_SCOPES = new Set(['hms', 'hospital', 'clinic']);
const PHARMACY_SCOPES = new Set(['pos', 'pharmacy']);

function explicitExpenseScope(expense: Record<string, unknown>): ExpenseScope | null {
  const value = expense.scope || expense.app || expense.module || expense.source || expense.createdFrom;
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (HMS_SCOPES.has(normalized)) return 'hms';
  if (PHARMACY_SCOPES.has(normalized)) return 'pharmacy';
  return null;
}

export function resolveExpenseScope(expense: Record<string, unknown>): ExpenseScope {
  const explicit = explicitExpenseScope(expense);
  if (explicit) return explicit;

  // Both modules created expenses before the scope field was introduced. HMS
  // records always carried these form fields, even when their values were blank;
  // the older pharmacy shape did not. This keeps legacy entries visible without
  // showing explicitly scoped records in the wrong module.
  const hmsOnlyFields = ['paymentMethod', 'vendor', 'invoiceNo', 'notes', 'updatedAt'];
  if (hmsOnlyFields.some(field => Object.prototype.hasOwnProperty.call(expense, field))) return 'hms';
  return 'pharmacy';
}

export function isExpenseInScope(expense: Record<string, unknown>, scope: ExpenseScope): boolean {
  return resolveExpenseScope(expense) === scope;
}
