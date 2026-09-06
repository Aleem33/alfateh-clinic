import { describe, expect, it } from 'vitest';
import { activationFields, clientBlockers } from '../../scripts/sync-rollout-policy.mjs';

const now = Date.parse('2026-09-06T08:00:00Z');
const client = { id: 'device-1', devicePrefix: 'R001', appVersion: '3.1.90', protocolVersion: 2,
  mirrorReady: true, lastSeenAt: '2026-09-06T07:00:00Z' };
const inputs = { control: { datasetGeneration: 1 }, clients: [client], now, operatorConfirmed: true, rulesMatch: true };
describe('guarded rollout policy', () => {
  it('requires explicit operator confirmation and deployed rule verification', () => {
    expect(() => activationFields({ ...inputs, operatorConfirmed: false })).toThrow('Explicit confirmation');
    expect(() => activationFields({ ...inputs, rulesMatch: false })).toThrow('Deployed rules');
  });
  it('blocks any incomplete, stale, pending, or old client', () => {
    for (const patch of [{ mirrorReady: false }, { appVersion: '3.1.89' }, { protocolVersion: 1 },
      { pendingChanges: 1 }, { lastSeenAt: '2026-09-01T00:00:00Z' }]) {
      expect(clientBlockers([{ ...client, ...patch }], now).length).toBeGreaterThan(0);
      expect(() => activationFields({ ...inputs, clients: [{ ...client, ...patch }] })).toThrow();
    }
    expect(() => activationFields({ ...inputs, clients: [] })).toThrow();
  });
  it('requires a fresh baseline and never edits input records', () => {
    expect(activationFields(inputs)).toMatchObject({ datasetGeneration: 2, confirmedDeviceIds: ['device-1'],
      incrementalEnabled: true, trackedWritesRequired: true, rulesEnforcementVersion: 2 });
    expect(inputs.control).toEqual({ datasetGeneration: 1 });
  });
  it('excludes only explicitly identified old test installations without deleting their records', () => {
    const testDevice = { ...client, id: 'old-test', mirrorReady: false };
    const clients = [client, testDevice];
    expect(() => activationFields({ ...inputs, clients })).toThrow();
    expect(activationFields({ ...inputs, clients, excludedTestDeviceIds: ['old-test'] })).toMatchObject({
      confirmedDeviceIds: ['device-1'], excludedTestDeviceIds: ['old-test'],
    });
    expect(clients.length).toBe(2);
    expect(testDevice.mirrorReady).toBe(false);
    expect(() => activationFields({ ...inputs, clients, excludedTestDeviceIds: ['typo'] })).toThrow();
    expect(() => activationFields({ ...inputs, clients, excludedTestDeviceIds: ['device-1', 'old-test'] })).toThrow();
  });
  it('blocks resets, repeated activation and invalid generations', () => {
    for (const control of [{ datasetGeneration: 1, resetInProgress: true },
      { datasetGeneration: 1, incrementalEnabled: true }, { datasetGeneration: NaN },
      { datasetGeneration: Number.MAX_SAFE_INTEGER }]) {
      expect(() => activationFields({ ...inputs, control })).toThrow();
    }
  });
});
