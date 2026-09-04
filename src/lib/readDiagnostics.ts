export type FirestoreReadSource = 'listener' | 'query' | 'bootstrap';
export type FirestoreReadReason = 'initial' | 'incremental' | 'route' | 'reconnect' | 'focus' | 'auth' | 'manual';

export type FirestoreReadCounter = {
  operations: number;
  documents: number;
};

export type FirestoreReadDiagnostics = {
  startedAt: string;
  updatedAt: string | null;
  total: FirestoreReadCounter;
  byCollection: Record<string, FirestoreReadCounter>;
  bySource: Record<string, FirestoreReadCounter>;
  byReason: Record<string, FirestoreReadCounter>;
  byRoute: Record<string, FirestoreReadCounter>;
};

export type FirestoreReadEvent = {
  collection: string;
  source: FirestoreReadSource;
  reason: FirestoreReadReason;
  documents: number;
  route?: string;
};

const STORAGE_KEY = 'alfateh.firestore-read-diagnostics.v1';
const subscribers = new Set<(diagnostics: FirestoreReadDiagnostics) => void>();

function emptyDiagnostics(): FirestoreReadDiagnostics {
  return {
    startedAt: new Date().toISOString(),
    updatedAt: null,
    total: { operations: 0, documents: 0 },
    byCollection: {},
    bySource: {},
    byReason: {},
    byRoute: {},
  };
}

function safeCounter(value: unknown): FirestoreReadCounter {
  const counter = value as Partial<FirestoreReadCounter> | null;
  return {
    operations: Math.max(0, Math.trunc(Number(counter?.operations) || 0)),
    documents: Math.max(0, Math.trunc(Number(counter?.documents) || 0)),
  };
}

function safeCounters(value: unknown): Record<string, FirestoreReadCounter> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, counter]) => [key, safeCounter(counter)]));
}

function loadDiagnostics(): FirestoreReadDiagnostics {
  if (typeof window === 'undefined' || !window.localStorage) return emptyDiagnostics();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDiagnostics();
    const saved = JSON.parse(raw) as Partial<FirestoreReadDiagnostics>;
    return {
      startedAt: typeof saved.startedAt === 'string' ? saved.startedAt : new Date().toISOString(),
      updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : null,
      total: safeCounter(saved.total),
      byCollection: safeCounters(saved.byCollection),
      bySource: safeCounters(saved.bySource),
      byReason: safeCounters(saved.byReason),
      byRoute: safeCounters(saved.byRoute),
    };
  } catch {
    return emptyDiagnostics();
  }
}

let diagnostics = loadDiagnostics();

function cloneCounters(counters: Record<string, FirestoreReadCounter>) {
  return Object.fromEntries(Object.entries(counters).map(([key, value]) => [key, { ...value }]));
}

function snapshot(): FirestoreReadDiagnostics {
  return {
    ...diagnostics,
    total: { ...diagnostics.total },
    byCollection: cloneCounters(diagnostics.byCollection),
    bySource: cloneCounters(diagnostics.bySource),
    byReason: cloneCounters(diagnostics.byReason),
    byRoute: cloneCounters(diagnostics.byRoute),
  };
}

function persist() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(diagnostics));
  } catch {
    // Diagnostics must never interfere with application data flow if local
    // storage is unavailable, full, or disabled.
  }
}

function currentRoute() {
  if (typeof window === 'undefined' || !window.location) return 'background';
  const hash = window.location.hash?.split('?')[0];
  return hash || window.location.pathname || 'unknown';
}

function add(counter: FirestoreReadCounter | undefined, documents: number): FirestoreReadCounter {
  return {
    operations: (counter?.operations || 0) + 1,
    documents: (counter?.documents || 0) + documents,
  };
}

export function recordFirestoreRead(event: FirestoreReadEvent): FirestoreReadDiagnostics {
  const collection = event.collection.trim() || 'unknown';
  const route = event.route?.trim() || currentRoute();
  const documents = Math.max(0, Math.trunc(Number(event.documents) || 0));
  const updatedAt = new Date().toISOString();

  diagnostics = {
    ...diagnostics,
    updatedAt,
    total: add(diagnostics.total, documents),
    byCollection: {
      ...diagnostics.byCollection,
      [collection]: add(diagnostics.byCollection[collection], documents),
    },
    bySource: {
      ...diagnostics.bySource,
      [event.source]: add(diagnostics.bySource[event.source], documents),
    },
    byReason: {
      ...diagnostics.byReason,
      [event.reason]: add(diagnostics.byReason[event.reason], documents),
    },
    byRoute: {
      ...diagnostics.byRoute,
      [route]: add(diagnostics.byRoute[route], documents),
    },
  };
  persist();
  const next = snapshot();
  subscribers.forEach(subscriber => subscriber(next));
  return next;
}

export function getFirestoreReadDiagnostics(): FirestoreReadDiagnostics {
  return snapshot();
}

export function subscribeToFirestoreReadDiagnostics(
  subscriber: (next: FirestoreReadDiagnostics) => void,
): () => void {
  subscribers.add(subscriber);
  subscriber(snapshot());
  return () => { subscribers.delete(subscriber); };
}

export function resetFirestoreReadDiagnostics(): FirestoreReadDiagnostics {
  diagnostics = emptyDiagnostics();
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Keep reset best-effort and local-only.
    }
  }
  const next = snapshot();
  subscribers.forEach(subscriber => subscriber(next));
  return next;
}
