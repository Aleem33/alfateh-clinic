import { describe, expect, it } from 'vitest';
import { cartItemUnits, findCartStockProblem } from './billingCart';

describe('billing cart stock units', () => {
  it('prints and deducts box quantities as total units', () => {
    expect(cartItemUnits({ quantity: 2, sellType: 'box', unitsPerBox: 20 })).toBe(40);
    expect(cartItemUnits({ quantity: 3, sellType: 'unit', unitsPerBox: 20 })).toBe(3);
  });

  it('aggregates box and loose lines for the same medicine batch', () => {
    const items = [
      { medicineId: 'batch-a', name: 'Example', quantity: 1, sellType: 'box', unitsPerBox: 10 },
      { medicineId: 'batch-a', name: 'Example', quantity: 3, sellType: 'unit', unitsPerBox: 10 },
    ];
    expect(findCartStockProblem(items, [{ id: 'batch-a', stock: 12 }])).toContain('needs 13');
    expect(findCartStockProblem(items, [{ id: 'batch-a', stock: 13 }])).toBe('');
  });

  it('warns when a held bill points to a removed batch', () => {
    expect(findCartStockProblem([
      { medicineId: 'missing', name: 'Old batch', quantity: 1, sellType: 'unit' },
    ], [])).toContain('no longer available');
  });
});
