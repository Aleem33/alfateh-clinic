const fs = require('fs');
const path = require('path');

const CLOCK_VERSION = 1;
const CACHE_FILE = 'trusted-clock.vault';
const MIN_SERVER_EPOCH_MS = Date.UTC(2020, 0, 1);
const MAX_SERVER_EPOCH_MS = Date.UTC(2100, 0, 1);
const MAX_RTT_MS = 30_000;
const DATE_HEADER_RESOLUTION_MS = 1_000;
const PERSIST_INTERVAL_MS = 5 * 60_000;
const MATERIAL_OFFSET_CHANGE_MS = 2_000;

function defaultMonotonicNow() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function estimateServerEpoch(dateHeader, roundTripMs = 0) {
  if (Array.isArray(dateHeader)) dateHeader = dateHeader[0];
  if (typeof dateHeader !== 'string' || !dateHeader.trim()) return null;
  const parsed = Date.parse(dateHeader);
  if (!Number.isFinite(parsed) || parsed < MIN_SERVER_EPOCH_MS || parsed >= MAX_SERVER_EPOCH_MS) return null;
  const rtt = Math.max(0, Math.min(MAX_RTT_MS, Number(roundTripMs) || 0));
  // HTTP Date has one-second resolution. Advancing by half the request RTT is
  // a conservative arrival-time estimate; the declared uncertainty preserves
  // that header-resolution limitation for audit and UI diagnostics.
  return {
    serverEpochMs: parsed + Math.round(rtt / 2),
    uncertaintyMs: DATE_HEADER_RESOLUTION_MS + Math.ceil(rtt / 2),
    roundTripMs: rtt,
  };
}

function validateClockCache(value) {
  if (!value || value.version !== CLOCK_VERSION) return null;
  const offsetMs = Number(value.offsetMs);
  const observedServerEpochMs = Number(value.observedServerEpochMs);
  const observedDeviceEpochMs = Number(value.observedDeviceEpochMs);
  const uncertaintyMs = Number(value.uncertaintyMs);
  if (![offsetMs, observedServerEpochMs, observedDeviceEpochMs, uncertaintyMs].every(Number.isFinite)) return null;
  if (observedServerEpochMs < MIN_SERVER_EPOCH_MS || observedServerEpochMs >= MAX_SERVER_EPOCH_MS) return null;
  if (uncertaintyMs < 0 || uncertaintyMs > DATE_HEADER_RESOLUTION_MS + MAX_RTT_MS) return null;
  if (Math.abs((observedServerEpochMs - observedDeviceEpochMs) - offsetMs) > 1) return null;
  return { version: CLOCK_VERSION, offsetMs, observedServerEpochMs, observedDeviceEpochMs, uncertaintyMs };
}

function createTrustedClock({ userDataPath, safeStorage, wallNow = Date.now, monotonicNow = defaultMonotonicNow }) {
  const cachePath = path.join(userDataPath, CACHE_FILE);
  let anchorEpochMs = Number(wallNow());
  let anchorMonotonicMs = Number(monotonicNow());
  let source = 'unverified';
  let observedServerEpochMs = 0;
  let uncertaintyMs = 0;
  let currentOffsetMs = 0;
  let lastReturnedEpochMs = anchorEpochMs;
  let hasIssuedTime = false;
  let lastPersistMonotonicMs = -Infinity;

  function encryptionAvailable() {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  }

  function readCache() {
    if (!encryptionAvailable()) return null;
    try {
      const encrypted = fs.readFileSync(cachePath);
      return validateClockCache(JSON.parse(safeStorage.decryptString(encrypted)));
    } catch {
      return null;
    }
  }

  function persistCache(cache) {
    if (!encryptionAvailable()) return false;
    const encrypted = safeStorage.encryptString(JSON.stringify(cache));
    fs.mkdirSync(userDataPath, { recursive: true });
    const temporaryPath = `${cachePath}.tmp`;
    fs.writeFileSync(temporaryPath, encrypted, { mode: 0o600 });
    try {
      fs.renameSync(temporaryPath, cachePath);
    } catch {
      fs.copyFileSync(temporaryPath, cachePath);
      fs.unlinkSync(temporaryPath);
    }
    return true;
  }

  function reanchor(epochMs, nextSource) {
    // Once a caller has observed the clock, second-resolution HTTP samples
    // must not move it backwards. Startup calibration may still correct a
    // badly mis-set device clock before the first snapshot is issued.
    anchorEpochMs = hasIssuedTime ? Math.max(Number(epochMs), lastReturnedEpochMs) : Number(epochMs);
    anchorMonotonicMs = Number(monotonicNow());
    lastReturnedEpochMs = anchorEpochMs;
    source = nextSource;
  }

  const cached = readCache();
  if (cached) {
    // A saved server/device offset corrects a consistently mis-set Windows
    // clock across restarts. Never reconstruct a time before the observation
    // that created the cache.
    const reconstructed = Math.max(Number(wallNow()) + cached.offsetMs, cached.observedServerEpochMs);
    currentOffsetMs = cached.offsetMs;
    observedServerEpochMs = cached.observedServerEpochMs;
    uncertaintyMs = cached.uncertaintyMs;
    reanchor(reconstructed, 'cached-server');
  }

  function nowMs() {
    const elapsed = Math.max(0, Number(monotonicNow()) - anchorMonotonicMs);
    const projected = anchorEpochMs + elapsed;
    lastReturnedEpochMs = Math.max(lastReturnedEpochMs, projected);
    hasIssuedTime = true;
    return Math.round(lastReturnedEpochMs);
  }

  function snapshot() {
    const current = nowMs();
    return {
      nowMs: current,
      nowIso: new Date(current).toISOString(),
      source,
      serverSyncedAtMs: observedServerEpochMs || undefined,
      ageMs: observedServerEpochMs ? Math.max(0, current - observedServerEpochMs) : undefined,
      uncertaintyMs: observedServerEpochMs ? uncertaintyMs : undefined,
    };
  }

  function observeServerDate(dateHeader, roundTripMs = 0) {
    const estimate = estimateServerEpoch(dateHeader, roundTripMs);
    if (!estimate) return false;
    const observedDeviceEpochMs = Number(wallNow());
    const nextOffsetMs = estimate.serverEpochMs - observedDeviceEpochMs;
    const previousOffsetMs = currentOffsetMs;
    const hadServerObservation = observedServerEpochMs > 0;
    currentOffsetMs = nextOffsetMs;
    observedServerEpochMs = estimate.serverEpochMs;
    uncertaintyMs = estimate.uncertaintyMs;
    reanchor(estimate.serverEpochMs, 'server');

    const monotonic = Number(monotonicNow());
    const shouldPersist = !hadServerObservation
      || monotonic - lastPersistMonotonicMs >= PERSIST_INTERVAL_MS
      || Math.abs(nextOffsetMs - previousOffsetMs) >= MATERIAL_OFFSET_CHANGE_MS;
    if (shouldPersist) {
      try {
        if (persistCache({
          version: CLOCK_VERSION,
          offsetMs: nextOffsetMs,
          observedServerEpochMs: estimate.serverEpochMs,
          observedDeviceEpochMs,
          uncertaintyMs: estimate.uncertaintyMs,
        })) lastPersistMonotonicMs = monotonic;
      } catch {
        // The runtime monotonic anchor remains valid even when disk persistence
        // is temporarily unavailable.
      }
    }
    return true;
  }

  return { encryptionAvailable, nowMs, observeServerDate, snapshot };
}

module.exports = { createTrustedClock, estimateServerEpoch, validateClockCache };
