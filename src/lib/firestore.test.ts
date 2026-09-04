import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMock = vi.hoisted(() => {
  const timestamp = { kind: 'server-timestamp' };
  const batches: any[] = [];
  const makeBatch = () => ({
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  });
  return {
    timestamp,
    batches,
    addDoc: vi.fn(),
    deleteDoc: vi.fn(),
    doc: vi.fn(),
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => timestamp),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    writeBatch: vi.fn(() => {
      const batch = makeBatch();
      batches.push(batch);
      return batch;
    }),
  };
});

const lanMock = vi.hoisted(() => ({
  online: true,
  ensureLanWriteAccess: vi.fn().mockResolvedValue(undefined),
  publishLanActivity: vi.fn().mockResolvedValue(undefined),
}));

const authMock = vi.hoisted(() => ({
  session: {
    mode: 'online',
    profile: { uid: 'admin-1' },
  } as any,
}));

vi.mock('firebase/firestore', () => firestoreMock);
vi.mock('./lanCoordinator', () => ({
  ensureLanWriteAccess: lanMock.ensureLanWriteAccess,
  isCloudOnline: () => lanMock.online,
  publishLanActivity: lanMock.publishLanActivity,
}));
vi.mock('./offlineAuth', () => ({
  getActiveAuthSession: () => authMock.session,
}));

import {
  addDoc,
  deleteDoc,
  hardDeleteDoc,
  setDoc,
  updateDoc,
  writeBatch,
  writeHardDeleteBatch,
} from './firestore';

const collectionRef = { path: 'medicines' } as any;
const medicineRef = { path: 'medicines/medicine-1' } as any;

describe('Firestore sync metadata gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreMock.batches.length = 0;
    firestoreMock.serverTimestamp.mockReturnValue(firestoreMock.timestamp);
    firestoreMock.addDoc.mockResolvedValue(medicineRef);
    firestoreMock.setDoc.mockResolvedValue(undefined);
    firestoreMock.updateDoc.mockResolvedValue(undefined);
    firestoreMock.deleteDoc.mockResolvedValue(undefined);
    lanMock.online = true;
    authMock.session = {
      mode: 'online',
      profile: { uid: 'admin-1' },
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds server revision metadata to online and offline auto-ID creates without mutating input', async () => {
    const input = { name: 'Medicine A', stock: 4 };

    await expect(addDoc(collectionRef, input)).resolves.toBe(medicineRef);
    expect(firestoreMock.addDoc).toHaveBeenCalledWith(collectionRef, {
      ...input,
      syncUpdatedAt: firestoreMock.timestamp,
      syncProtocolVersion: 2,
    });
    expect(input).toEqual({ name: 'Medicine A', stock: 4 });
    expect(lanMock.publishLanActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'created',
      collection: 'medicines',
      recordId: 'medicine-1',
      label: 'Medicine A',
    }));

    vi.clearAllMocks();
    vi.stubGlobal('navigator', { onLine: false });
    lanMock.online = false;
    const offlineRef = { path: 'medicines/offline-1' };
    firestoreMock.doc.mockReturnValue(offlineRef);
    firestoreMock.setDoc.mockReturnValue(new Promise(() => undefined));

    await expect(addDoc(collectionRef, input)).resolves.toBe(offlineRef);
    expect(firestoreMock.setDoc).toHaveBeenCalledWith(offlineRef, {
      ...input,
      syncUpdatedAt: firestoreMock.timestamp,
      syncProtocolVersion: 2,
    });
    expect(lanMock.publishLanActivity).toHaveBeenCalledOnce();
  });

  it('preserves set merge semantics and extends explicit merge fields for metadata', async () => {
    const input = { stock: 10 };
    const options = { mergeFields: ['stock'] };

    await setDoc(medicineRef, input, options);

    expect(firestoreMock.setDoc).toHaveBeenCalledWith(
      medicineRef,
      {
        stock: 10,
        syncUpdatedAt: firestoreMock.timestamp,
        syncProtocolVersion: 2,
      },
      {
        mergeFields: ['stock', 'syncUpdatedAt', 'syncProtocolVersion'],
      },
    );
    expect(options).toEqual({ mergeFields: ['stock'] });
  });

  it('keeps sentinel values in object updates while overriding stale sync metadata', async () => {
    const incrementValue = { kind: 'increment', amount: 5 };
    const input = {
      stock: incrementValue,
      syncUpdatedAt: 'stale',
      syncProtocolVersion: 1,
    };

    await updateDoc(medicineRef, input);

    expect(firestoreMock.updateDoc).toHaveBeenCalledWith(medicineRef, {
      stock: incrementValue,
      syncUpdatedAt: firestoreMock.timestamp,
      syncProtocolVersion: 2,
    });
    expect(input).toEqual({
      stock: incrementValue,
      syncUpdatedAt: 'stale',
      syncProtocolVersion: 1,
    });
  });

  it('preserves string and FieldPath-style update overloads and appends sync fields', async () => {
    const incrementValue = { kind: 'increment', amount: 5 };
    await (updateDoc as any)(medicineRef, 'stock', incrementValue, 'costPrice', 25);

    expect(firestoreMock.updateDoc).toHaveBeenLastCalledWith(
      medicineRef,
      'stock',
      incrementValue,
      'costPrice',
      25,
      'syncUpdatedAt',
      firestoreMock.timestamp,
      'syncProtocolVersion',
      2,
    );

    const fieldPath = { kind: 'field-path', segments: ['stock'] };
    await (updateDoc as any)(medicineRef, fieldPath, incrementValue);
    expect(firestoreMock.updateDoc).toHaveBeenLastCalledWith(
      medicineRef,
      fieldPath,
      incrementValue,
      'syncUpdatedAt',
      firestoreMock.timestamp,
      'syncProtocolVersion',
      2,
    );
  });

  it('soft-deletes ordinary documents with actor and revision metadata', async () => {
    await deleteDoc(medicineRef);

    expect(firestoreMock.updateDoc).toHaveBeenCalledWith(medicineRef, {
      deleted: true,
      deletedAt: firestoreMock.timestamp,
      deletedBy: 'admin-1',
      syncUpdatedAt: firestoreMock.timestamp,
      syncProtocolVersion: 2,
    });
    expect(firestoreMock.deleteDoc).not.toHaveBeenCalled();
    expect(lanMock.publishLanActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deleted',
      collection: 'medicines',
      recordId: 'medicine-1',
    }));
  });

  it('adds metadata to batch writes and converts ordinary batch deletes to updates', async () => {
    const batch = writeBatch({} as any);
    const incrementValue = { kind: 'increment', amount: 3 };

    batch
      .set(medicineRef, { name: 'Medicine A' }, { mergeFields: ['name'] })
      .update(medicineRef, 'stock', incrementValue)
      .delete(medicineRef);
    await batch.commit();

    const underlying = firestoreMock.batches[0];
    expect(underlying.set).toHaveBeenCalledWith(
      medicineRef,
      {
        name: 'Medicine A',
        syncUpdatedAt: firestoreMock.timestamp,
        syncProtocolVersion: 2,
      },
      {
        mergeFields: ['name', 'syncUpdatedAt', 'syncProtocolVersion'],
      },
    );
    expect(underlying.update).toHaveBeenNthCalledWith(
      1,
      medicineRef,
      'stock',
      incrementValue,
      'syncUpdatedAt',
      firestoreMock.timestamp,
      'syncProtocolVersion',
      2,
    );
    expect(underlying.update).toHaveBeenNthCalledWith(2, medicineRef, {
      deleted: true,
      deletedAt: firestoreMock.timestamp,
      deletedBy: 'admin-1',
      syncUpdatedAt: firestoreMock.timestamp,
      syncProtocolVersion: 2,
    });
    expect(underlying.delete).not.toHaveBeenCalled();
    expect(underlying.commit).toHaveBeenCalledOnce();
    expect(lanMock.ensureLanWriteAccess).toHaveBeenCalledOnce();
    expect(lanMock.publishLanActivity).toHaveBeenCalledTimes(3);
  });

  it('keeps offline batch commits queued without waiting for cloud acknowledgement', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    lanMock.online = false;
    const batch = writeBatch({} as any);
    const underlying = firestoreMock.batches[0];
    underlying.commit.mockReturnValue(new Promise(() => undefined));

    batch.set(medicineRef, { stock: 1 });
    await expect(batch.commit()).resolves.toBeUndefined();
    expect(underlying.commit).toHaveBeenCalledOnce();
    expect(lanMock.publishLanActivity).toHaveBeenCalledOnce();
  });

  it('provides explicit permanent-delete paths for the admin full reset only', async () => {
    await hardDeleteDoc(medicineRef);
    expect(firestoreMock.deleteDoc).toHaveBeenCalledWith(medicineRef);
    expect(firestoreMock.updateDoc).not.toHaveBeenCalled();

    const batch = writeHardDeleteBatch({} as any);
    batch.delete(medicineRef);
    await batch.commit();

    const underlying = firestoreMock.batches[0];
    expect(underlying.delete).toHaveBeenCalledWith(medicineRef);
    expect(underlying.update).not.toHaveBeenCalled();
    expect(lanMock.publishLanActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'permanently deleted',
    }));
  });
});
