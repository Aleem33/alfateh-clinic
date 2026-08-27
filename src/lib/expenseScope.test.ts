import { describe, expect, it } from 'vitest';
import { isExpenseInScope, resolveExpenseScope } from './expenseScope';

describe('expense scope isolation', () => {
  it('keeps explicitly scoped pharmacy and HMS expenses separate', () => {
    expect(isExpenseInScope({ scope: 'pharmacy' }, 'pharmacy')).toBe(true);
    expect(isExpenseInScope({ scope: 'pharmacy' }, 'hms')).toBe(false);
    expect(isExpenseInScope({ scope: 'hms' }, 'hms')).toBe(true);
    expect(isExpenseInScope({ scope: 'hms' }, 'pharmacy')).toBe(false);
  });

  it('understands legacy scope aliases', () => {
    expect(resolveExpenseScope({ module: 'hospital' })).toBe('hms');
    expect(resolveExpenseScope({ source: 'POS' })).toBe('pharmacy');
  });

  it('keeps pre-scope records visible in their original module by shape', () => {
    expect(resolveExpenseScope({ description: 'Electric bill', amount: 1000 })).toBe('pharmacy');
    expect(resolveExpenseScope({ description: 'Ward supplies', amount: 1000, paymentMethod: '' })).toBe('hms');
  });
});
