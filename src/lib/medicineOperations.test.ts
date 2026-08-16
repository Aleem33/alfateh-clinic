import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  addDoc: vi.fn(),
  collection: vi.fn((_db: unknown, name: string) => ({ name })),
  doc: vi.fn(),
  getDocsFromServer: vi.fn(),
  limit: vi.fn((value: number) => ({ value })),
  query: vi.fn((...parts: unknown[]) => parts),
  updateDoc: vi.fn(),
  where: vi.fn((...parts: unknown[]) => parts),
}));

const store = vi.hoisted(() => ({ all: [] as any[] }));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({
  auth: { currentUser: { uid: 'admin-1', email: 'admin@example.com' } },
  db: {},
}));
vi.mock('./medicineStore', () => ({
  getMedicineStoreSnapshot: () => ({
    all: store.all,
    active: store.all.filter(medicine => medicine.archived !== true),
    archived: store.all.filter(medicine => medicine.archived === true),
    hasLoaded: true,
    fromCache: false,
  }),
}));

import {
  createMedicineSafely,
  ensureMedicinePurchaseBatch,
  findMedicinePurchaseBatch,
  MedicineConflictError,
} from './medicineOperations';

const input = {
  name: 'Novidat 200 mg',
  category: 'Injection',
  supplierId: 'supplier-a',
  supplierName: 'Ahsan Trader',
  batchNo: 'B-1',
  stock: 1,
};

describe('createMedicineSafely', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', { onLine: true });
    store.all = [];
    firestore.getDocsFromServer.mockResolvedValue({ empty: true, docs: [] });
    firestore.addDoc.mockResolvedValue({ id: 'auto-generated-id' });
  });

  it('creates with a Firestore auto ID instead of addressing an existing document', async () => {
    await expect(createMedicineSafely(input)).resolves.toBe('auto-generated-id');
    expect(firestore.addDoc).toHaveBeenCalledOnce();
    expect(firestore.addDoc.mock.calls[0][0]).toEqual({ name: 'medicines' });
    expect(firestore.addDoc.mock.calls[0][1]).toMatchObject({
      name: input.name,
      archived: false,
      medicineKey: 'novidat 200 mg|injection|b 1|supplier a',
    });
  });

  it('blocks an exact duplicate found in the shared offline cache', async () => {
    store.all = [{ id: 'existing', ...input }];

    await expect(createMedicineSafely(input)).rejects.toBeInstanceOf(MedicineConflictError);
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
    expect(firestore.addDoc).not.toHaveBeenCalled();
  });

  it('blocks an exact duplicate returned by the server check', async () => {
    firestore.getDocsFromServer.mockResolvedValue({
      empty: false,
      docs: [{ id: 'server-existing', data: () => input }],
    });

    await expect(createMedicineSafely(input)).rejects.toMatchObject({
      name: 'MedicineConflictError',
      medicineId: 'server-existing',
    });
    expect(firestore.addDoc).not.toHaveBeenCalled();
  });

  it('allows the same medicine name for a distinct supplier or batch', async () => {
    store.all = [{ id: 'existing', ...input }];

    await expect(createMedicineSafely({ ...input, supplierId: 'supplier-b' })).resolves.toBe('auto-generated-id');
    expect(firestore.addDoc).toHaveBeenCalledOnce();
  });
});

describe('ensureMedicinePurchaseBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', { onLine: true });
    store.all = [];
    firestore.getDocsFromServer.mockResolvedValue({ empty: true, docs: [] });
    firestore.addDoc.mockResolvedValue({ id: 'new-batch-id' });
  });

  const source = { id: 'batch-a', ...input, stock: 10, retailPrice: 330, unitPrice: 330 };
  const purchase = {
    batchNo: 'B-2', expiryDate: '2027-12-31', stock: 5, unitsPerBox: 1,
    costPrice: 210, retailPrice: 340, unitPrice: 340,
    supplierId: 'supplier-a', supplierName: 'Ahsan Trader',
  };

  it('keeps stock on the selected record when the purchased batch already exists', async () => {
    await expect(ensureMedicinePurchaseBatch(source, { ...purchase, batchNo: 'B-1' }, [source])).resolves.toEqual({
      medicineId: 'batch-a',
      created: false,
    });
    expect(firestore.addDoc).not.toHaveBeenCalled();
  });

  it('routes a repeat purchase into an existing matching batch record', async () => {
    const batchB = { ...source, id: 'batch-b', batchNo: 'B-2', stock: 3 };
    await expect(ensureMedicinePurchaseBatch(source, purchase, [source, batchB])).resolves.toEqual({
      medicineId: 'batch-b',
      created: false,
    });
    expect(firestore.addDoc).not.toHaveBeenCalled();
  });

  it('creates a separate medicine record for a genuinely new batch', async () => {
    const originalSource = { ...source };
    await expect(ensureMedicinePurchaseBatch(source, purchase, [source])).resolves.toEqual({
      medicineId: 'new-batch-id',
      created: true,
    });
    expect(firestore.addDoc.mock.calls[0][1]).toMatchObject({
      name: source.name,
      batchNo: 'B-2',
      stock: 5,
      createdFromMedicineId: 'batch-a',
      createdFromPurchase: true,
      costPrice: 210,
      retailPrice: 340,
      unitPrice: 340,
    });
    expect(source).toEqual(originalSource);
  });

  it('identifies an existing batch before a purchase changes any prices', () => {
    const batchB = { ...source, id: 'batch-b', batchNo: 'B-2', retailPrice: 410 };

    expect(findMedicinePurchaseBatch(source, purchase, [source, batchB])).toBe(batchB);
    expect(findMedicinePurchaseBatch(source, { ...purchase, batchNo: 'B-3' }, [source, batchB])).toBeUndefined();
  });
});
