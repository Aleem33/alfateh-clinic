import { describe, expect, it } from 'vitest';
import { calculateBillDiscount, normalizeBillDiscountValue } from './billDiscount';

describe('whole-bill discount', () => {
  it('calculates a percentage discount', () => {
    expect(calculateBillDiscount(2000, 'pct', 10)).toBe(200);
  });

  it('calculates a rupee discount', () => {
    expect(calculateBillDiscount(2000, 'rs', 150)).toBe(150);
  });

  it('never makes a bill negative and caps percentage at 100', () => {
    expect(calculateBillDiscount(500, 'rs', 700)).toBe(500);
    expect(normalizeBillDiscountValue('pct', 140)).toBe(100);
    expect(calculateBillDiscount(500, 'pct', 140)).toBe(500);
  });
});

