import { describe, expect, it } from 'vitest';
import {
  findDuplicateMedicine,
  groupMedicineBatches,
  normalizeMedicineText,
  partitionMedicines,
  searchMedicines,
  type MedicineRecord,
} from './medicineIndex';

function medicine(id: string, overrides: Record<string, unknown> = {}): MedicineRecord {
  return {
    id,
    name: 'Novidat 200 mg',
    category: 'Injection',
    supplierId: 'supplier-a',
    supplierName: 'Ahsan Trader',
    batchNo: 'B-1',
    stock: 10,
    retailPrice: 330,
    ...overrides,
  };
}

describe('medicine indexing and visibility', () => {
  it('normalizes case, punctuation, and spacing for reliable searches', () => {
    expect(normalizeMedicineText('  NOVIDAT—200   MG ')).toBe('novidat 200 mg');
    expect(searchMedicines([medicine('one')], 'novidat-200 MG')).toHaveLength(1);
  });

  it('returns every matching Firestore document without name deduplication', () => {
    const records = [
      medicine('one'),
      medicine('two'),
      medicine('three', { supplierId: 'supplier-b', supplierName: 'City Pharma' }),
    ];

    expect(searchMedicines(records, 'Novidat')).toHaveLength(3);
    expect(searchMedicines(records, 'Novidat').map(record => record.id)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('keeps identical names selectable when supplier or batch differs', () => {
    const records = [
      medicine('supplier-a'),
      medicine('supplier-b', { supplierId: 'supplier-b', supplierName: 'City Pharma' }),
      medicine('batch-b', { batchNo: 'B-2' }),
    ];

    expect(searchMedicines(records, 'Injection')).toHaveLength(3);
    expect(findDuplicateMedicine(records, medicine('new', { supplierId: 'supplier-c' }))).toBeUndefined();
    expect(findDuplicateMedicine(records, medicine('new', { batchNo: 'B-2' }))?.id).toBe('batch-b');
  });

  it('groups a medicine for billing without collapsing its batch records', () => {
    const records = [
      medicine('batch-b', { batchNo: 'B-2', expiryDate: '2027-12-31', retailPrice: 350, stock: 8 }),
      medicine('batch-a', { batchNo: 'B-1', expiryDate: '2027-06-30', retailPrice: 330, stock: 10 }),
    ];

    const groups = groupMedicineBatches(records);

    expect(groups).toHaveLength(1);
    expect(groups[0].totalStock).toBe(18);
    expect(groups[0].batches.map(batch => batch.id)).toEqual(['batch-a', 'batch-b']);
    expect(groups[0].batches.map(batch => batch.retailPrice)).toEqual([330, 350]);
  });

  it('filters stock only when an operational selector requests it', () => {
    const records = [medicine('available'), medicine('empty', { stock: 0 })];
    expect(searchMedicines(records, '', { inStockOnly: true }).map(record => record.id)).toEqual(['available']);
  });

  it('treats legacy records as active and partitions archived records', () => {
    const legacy = medicine('legacy');
    const active = medicine('active', { archived: false });
    const archived = medicine('archived', { archived: true });

    expect(partitionMedicines([legacy, active, archived])).toEqual({
      active: [legacy, active],
      archived: [archived],
    });
  });
});
