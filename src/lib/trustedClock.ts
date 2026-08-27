import type { TrustedClockSnapshot } from '../types/electron';

const CLOCK_REFRESH_INTERVAL_MS = 30_000;
const MIN_VALID_EPOCH_MS = Date.UTC(2020, 0, 1);
const MAX_VALID_EPOCH_MS = Date.UTC(2100, 0, 1);

type RuntimeAnchor = {
  epochMs: number;
  monotonicMs: number;
  snapshot: TrustedClockSnapshot;
};

export type TrustedClockReading = TrustedClockSnapshot & {
  date: Date;
};

let anchor: RuntimeAnchor | null = null;
let refreshPromise: Promise<TrustedClockSnapshot> | null = null;
let started = false;

function monotonicNow() {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function localFallback(): TrustedClockSnapshot {
  const nowMs = Date.now();
  return { nowMs, nowIso: new Date(nowMs).toISOString(), source: 'unverified' };
}

function validSnapshot(value: TrustedClockSnapshot | undefined): value is TrustedClockSnapshot {
  return Boolean(
    value
    && Number.isFinite(value.nowMs)
    && value.nowMs >= MIN_VALID_EPOCH_MS
    && value.nowMs < MAX_VALID_EPOCH_MS
    && ['server', 'cached-server', 'unverified'].includes(value.source),
  );
}

function applySnapshot(value: TrustedClockSnapshot) {
  anchor = { epochMs: value.nowMs, monotonicMs: monotonicNow(), snapshot: value };
  return value;
}

export function currentTrustedClockSnapshot(): TrustedClockSnapshot {
  if (!anchor) applySnapshot(localFallback());
  const elapsed = Math.max(0, monotonicNow() - anchor!.monotonicMs);
  const nowMs = Math.round(anchor!.epochMs + elapsed);
  const serverSyncedAtMs = anchor!.snapshot.serverSyncedAtMs;
  return {
    ...anchor!.snapshot,
    nowMs,
    nowIso: new Date(nowMs).toISOString(),
    ageMs: serverSyncedAtMs == null ? undefined : Math.max(0, nowMs - serverSyncedAtMs),
  };
}

export async function refreshTrustedClock(): Promise<TrustedClockSnapshot> {
  if (refreshPromise) return refreshPromise;
  const task = (async () => {
    if (!window.electronAPI) return applySnapshot(localFallback());
    try {
      const requestStartedAt = monotonicNow();
      const next = await window.electronAPI.getTrustedClockSnapshot();
      if (!validSnapshot(next)) return currentTrustedClockSnapshot();
      const responseElapsed = Math.max(0, monotonicNow() - requestStartedAt);
      return applySnapshot({
        ...next,
        nowMs: next.nowMs + responseElapsed,
        nowIso: new Date(next.nowMs + responseElapsed).toISOString(),
        uncertaintyMs: (next.uncertaintyMs || 0) + responseElapsed,
      });
    } catch {
      return currentTrustedClockSnapshot();
    }
  })();
  refreshPromise = task;
  try {
    return await task;
  } finally {
    if (refreshPromise === task) refreshPromise = null;
  }
}

export async function getTrustedClockReading(): Promise<TrustedClockReading> {
  await refreshTrustedClock();
  const snapshot = currentTrustedClockSnapshot();
  return { ...snapshot, date: new Date(snapshot.nowMs) };
}

export function trustedNow(): Date {
  return new Date(currentTrustedClockSnapshot().nowMs);
}

export function trustedNowISO(): string {
  return currentTrustedClockSnapshot().nowIso;
}

export async function initializeTrustedClock() {
  if (!started) {
    started = true;
    window.setInterval(() => { void refreshTrustedClock(); }, CLOCK_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', () => { void refreshTrustedClock(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refreshTrustedClock();
    });
  }
  return refreshTrustedClock();
}
