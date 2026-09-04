import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => ({ name })),
  getDocsFromServer: vi.fn(),
  listeners: new Map<string, (snapshot: any) => void>(),
  onSnapshot: vi.fn((
    reference: { name: string },
    _options: unknown,
    onData: (snapshot: any) => void,
  ) => {
    firestore.listeners.set(reference.name, onData);
    return vi.fn();
  }),
}));

const lan = vi.hoisted(() => ({
  online: true,
  listeners: [] as Array<(status: { online: boolean }) => void>,
}));

const readDiagnostics = vi.hoisted(() => ({
  recordFirestoreRead: vi.fn(),
}));

vi.mock('@/lib/firestore', () => ({
  collection: firestore.collection,
  getDocsFromServer: firestore.getDocsFromServer,
  onSnapshot: firestore.onSnapshot,
}));
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('./lanCoordinator', () => ({
  isCloudOnline: () => lan.online,
  subscribeLanStatus: (listener: (status: { online: boolean }) => void) => {
    lan.listeners.push(listener);
    listener({ online: lan.online });
    return () => undefined;
  },
}));
vi.mock('./readDiagnostics', () => ({
  recordFirestoreRead: readDiagnostics.recordFirestoreRead,
}));

function serverSnapshot(ids: string[], changed = ids.length) {
  return {
    docs: ids.map(id => ({ id, data: () => ({ receiptNo: id }) })),
    metadata: { fromCache: false },
    docChanges: () => Array.from({ length: changed }, () => ({})),
  };
}

function setOnline(online: boolean) {
  lan.online = online;
  lan.listeners.forEach(listener => listener({ online }));
}

describe('shared sales store read policy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    firestore.listeners.clear();
    lan.listeners = [];
    lan.online = true;
    vi.stubGlobal('window', new EventTarget());
  });

  it('never runs a full server scan on subscribe, focus, or auth readiness', async () => {
    const { subscribeToSales } = await import('./salesStore');
    const onData = vi.fn();

    subscribeToSales(onData);
    expect(firestore.onSnapshot).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('alfateh:auth-sync-ready'));

    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
    expect(firestore.onSnapshot).toHaveBeenCalledOnce();

    firestore.listeners.get('sales')?.(serverSnapshot(['SALE-1', 'SALE-2']));
    expect(onData).toHaveBeenLastCalledWith([
      { id: 'SALE-1', receiptNo: 'SALE-1' },
      { id: 'SALE-2', receiptNo: 'SALE-2' },
    ]);
    expect(readDiagnostics.recordFirestoreRead).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'sales',
      source: 'listener',
      reason: 'initial',
      documents: 2,
    }));
  });

  it('keeps the existing listener on reconnect instead of downloading full history', async () => {
    const { subscribeToSaleReturns } = await import('./salesStore');
    const onData = vi.fn();

    subscribeToSaleReturns(onData);
    firestore.listeners.get('saleReturns')?.(serverSnapshot(['RETURN-1']));
    setOnline(false);
    setOnline(true);

    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
    expect(firestore.onSnapshot).toHaveBeenCalledOnce();

    firestore.listeners.get('saleReturns')?.(serverSnapshot(['RETURN-1', 'RETURN-2'], 1));
    expect(onData).toHaveBeenLastCalledWith([
      { id: 'RETURN-1', receiptNo: 'RETURN-1' },
      { id: 'RETURN-2', receiptNo: 'RETURN-2' },
    ]);
    expect(readDiagnostics.recordFirestoreRead).toHaveBeenLastCalledWith(expect.objectContaining({
      collection: 'saleReturns',
      source: 'listener',
      reason: 'reconnect',
      documents: 1,
    }));
  });
});
