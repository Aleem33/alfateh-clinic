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

import { createMedicineSafely, MedicineConflictError } from './medicineOperations';

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
