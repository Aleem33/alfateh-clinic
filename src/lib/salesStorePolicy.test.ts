import { describe, expect, it } from 'vitest';
import { shouldPublishSalesSnapshot } from './salesStorePolicy';

describe('sales snapshot source policy', () => {
  it('rejects stale cache snapshots while cloud-online', () => {
    expect(shouldPublishSalesSnapshot(true, true)).toBe(false);
  });

  it('accepts server-confirmed snapshots while cloud-online', () => {
    expect(shouldPublishSalesSnapshot(false, true)).toBe(true);
  });

  it('accepts cached snapshots while genuinely offline', () => {
    expect(shouldPublishSalesSnapshot(true, false)).toBe(true);
  });
});
