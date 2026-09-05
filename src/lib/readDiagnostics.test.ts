import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getFirestoreReadDiagnostics,
  recordFirestoreRead,
  resetFirestoreReadDiagnostics,
  subscribeToFirestoreReadDiagnostics,
} from './readDiagnostics';

describe('local Firestore read diagnostics', () => {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };

  beforeEach(() => {
    values.clear();
    vi.clearAllMocks();
    vi.stubGlobal('window', {
      location: { hash: '#/pos/reports?range=today', pathname: '/app' },
      localStorage,
    });
    resetFirestoreReadDiagnostics();
    vi.clearAllMocks();
  });

  it('counts reads by collection, source, reason, and route without a remote write', () => {
    recordFirestoreRead({
      collection: 'sales',
      source: 'listener',
      reason: 'initial',
      documents: 12,
    });
    const diagnostics = recordFirestoreRead({
      collection: 'sales',
      source: 'listener',
      reason: 'reconnect',
      documents: 2,
      route: '#/pos/dashboard',
    });

    expect(diagnostics.total).toEqual({ operations: 2, documents: 14 });
    expect(diagnostics.byCollection.sales).toEqual({ operations: 2, documents: 14 });
    expect(diagnostics.bySource.listener).toEqual({ operations: 2, documents: 14 });
    expect(diagnostics.byReason.initial).toEqual({ operations: 1, documents: 12 });
    expect(diagnostics.byReason.reconnect).toEqual({ operations: 1, documents: 2 });
    expect(diagnostics.byRoute['#/pos/reports']).toEqual({ operations: 1, documents: 12 });
    expect(diagnostics.byRoute['#/pos/dashboard']).toEqual({ operations: 1, documents: 2 });
    expect(localStorage.setItem).toHaveBeenCalledTimes(2);
  });

  it('publishes defensive snapshots and resets only local state', () => {
    const updates: number[] = [];
    const unsubscribe = subscribeToFirestoreReadDiagnostics(next => updates.push(next.total.documents));

    const recorded = recordFirestoreRead({
      collection: 'saleReturns',
      source: 'query',
      reason: 'route',
      documents: 3,
    });
    recorded.total.documents = 999;
    expect(getFirestoreReadDiagnostics().total.documents).toBe(3);

    unsubscribe();
    resetFirestoreReadDiagnostics();
    expect(updates).toEqual([0, 3]);
    expect(getFirestoreReadDiagnostics().total).toEqual({ operations: 0, documents: 0 });
    expect(localStorage.removeItem).toHaveBeenCalled();
  });
});
