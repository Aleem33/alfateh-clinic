import { describe, expect, it } from 'vitest';
import { findClearedStockIssueIds, shouldWriteNegativeStockIssue } from './stockSyncIssues';

describe('stock sync issue reconciliation', () => {
  it('closes an open warning after its medicine is no longer negative', () => {
    const issues = [
      { id: 'stock-preset', type: 'stock-negative', status: 'open', medicineId: 'preset', stock: -1 },
      { id: 'stock-other', type: 'stock-negative', status: 'open', medicineId: 'other', stock: -2 },
    ];

    expect(findClearedStockIssueIds(issues, new Set(['other']))).toEqual(['stock-preset']);
  });

  it('does not repeatedly rewrite an unchanged open warning', () => {
    expect(shouldWriteNegativeStockIssue(
      { id: 'stock-preset', type: 'stock-negative', status: 'open', medicineId: 'preset', stock: -1 },
      -1,
    )).toBe(false);
  });

  it('writes a warning for a new, changed, or previously resolved negative condition', () => {
    expect(shouldWriteNegativeStockIssue(undefined, -1)).toBe(true);
    expect(shouldWriteNegativeStockIssue(
      { id: 'stock-preset', status: 'open', medicineId: 'preset', stock: -1 },
      -2,
    )).toBe(true);
    expect(shouldWriteNegativeStockIssue(
      { id: 'stock-preset', status: 'resolved', medicineId: 'preset', stock: -1 },
      -1,
    )).toBe(true);
  });
});
