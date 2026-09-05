import { describe, expect, it } from 'vitest';
import { normalizeSyncControl, shouldUseIncrementalMirror, isIncrementalControlCompatible, SYNC_PROTOCOL_VERSION } from './syncProtocol';

describe('sync protocol control', () => {
  it('defaults to the lossless legacy fallback', () => {
    const value = normalizeSyncControl(null);
    expect(value.incrementalEnabled).toBe(false);
    expect(value.protocolVersion).toBe(SYNC_PROTOCOL_VERSION);
    expect(value.datasetGeneration).toBe(1);
    expect(shouldUseIncrementalMirror(value)).toBe(false);
  });

  it('enables incremental mode only for a compatible protocol', () => {
    expect(isIncrementalControlCompatible(normalizeSyncControl({
      incrementalEnabled: true,
      trackedWritesRequired: true,
      minimumProtocolVersion: SYNC_PROTOCOL_VERSION,
      datasetGeneration: 3,
    }))).toBe(true);
    expect(shouldUseIncrementalMirror(normalizeSyncControl({
      incrementalEnabled: true,
      trackedWritesRequired: true,
      minimumProtocolVersion: SYNC_PROTOCOL_VERSION + 1,
    }))).toBe(false);
  });

  it('honors the remote rollback switch', () => {
    expect(shouldUseIncrementalMirror(normalizeSyncControl({
      incrementalEnabled: true,
      trackedWritesRequired: true,
      rollbackToLegacy: true,
    }))).toBe(false);
  });

  it('does not enter incremental mode until the server blocks untracked legacy writes', () => {
    expect(shouldUseIncrementalMirror(normalizeSyncControl({
      incrementalEnabled: true,
      trackedWritesRequired: false,
      minimumProtocolVersion: SYNC_PROTOCOL_VERSION,
    }))).toBe(false);
  });

  it('keeps the first release in verification mode even if a remote flag is enabled prematurely', () => {
    expect(shouldUseIncrementalMirror(normalizeSyncControl({ incrementalEnabled: true, trackedWritesRequired: true }))).toBe(false);
  });
});
