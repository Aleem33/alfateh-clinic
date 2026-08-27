import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createTrustedClock, estimateServerEpoch } = require('../../trustedClock.js');

function testSafeStorage() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value: string) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value: Buffer) {
      const iv = value.subarray(0, 12);
      const tag = value.subarray(12, 28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

describe('Electron trusted clock', () => {
  let directory: string;
  let safeStorage: ReturnType<typeof testSafeStorage>;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alfateh-trusted-clock-'));
    safeStorage = testSafeStorage();
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('calibrates a device that is one day ahead to the HTTPS server date', () => {
    let wall = Date.parse('2026-08-28T12:00:00.000Z');
    let monotonic = 100;
    const clock = createTrustedClock({
      userDataPath: directory,
      safeStorage,
      wallNow: () => wall,
      monotonicNow: () => monotonic,
    });

    expect(clock.observeServerDate('Thu, 27 Aug 2026 12:00:00 GMT', 0)).toBe(true);
    expect(clock.snapshot()).toMatchObject({
      nowIso: '2026-08-27T12:00:00.000Z',
      source: 'server',
    });

    wall += 24 * 60 * 60_000;
    monotonic += 5_000;
    expect(clock.snapshot().nowIso).toBe('2026-08-27T12:00:05.000Z');
  });

  it('never moves backwards when a later HTTP sample is rounded behind the issued time', () => {
    let wall = Date.parse('2026-08-27T12:00:00.000Z');
    let monotonic = 0;
    const clock = createTrustedClock({ userDataPath: directory, safeStorage, wallNow: () => wall, monotonicNow: () => monotonic });
    clock.observeServerDate('Thu, 27 Aug 2026 12:00:00 GMT', 0);
    clock.snapshot();
    monotonic = 5_000;
    const before = clock.snapshot().nowMs;
    wall += 5_000;
    clock.observeServerDate('Thu, 27 Aug 2026 12:00:04 GMT', 0);
    expect(clock.snapshot().nowMs).toBeGreaterThanOrEqual(before);
  });

  it('reopens with the encrypted cached offset while offline', () => {
    let wall = Date.parse('2026-08-28T12:00:00.000Z');
    const first = createTrustedClock({ userDataPath: directory, safeStorage, wallNow: () => wall, monotonicNow: () => 0 });
    first.observeServerDate('Thu, 27 Aug 2026 12:00:00 GMT', 0);
    const persisted = fs.readFileSync(path.join(directory, 'trusted-clock.vault')).toString('utf8');
    expect(persisted).not.toContain('2026-08-27');

    wall += 10 * 60_000;
    const reopened = createTrustedClock({ userDataPath: directory, safeStorage, wallNow: () => wall, monotonicNow: () => 500 });
    expect(reopened.snapshot()).toMatchObject({
      nowIso: '2026-08-27T12:10:00.000Z',
      source: 'cached-server',
    });
  });

  it('rejects malformed server headers and corrupted cache data without throwing', () => {
    fs.writeFileSync(path.join(directory, 'trusted-clock.vault'), Buffer.from('not encrypted'));
    const wall = Date.parse('2026-08-27T12:00:00.000Z');
    const clock = createTrustedClock({ userDataPath: directory, safeStorage, wallNow: () => wall, monotonicNow: () => 0 });
    expect(clock.snapshot().source).toBe('unverified');
    expect(clock.observeServerDate('not a date', 0)).toBe(false);
    expect(estimateServerEpoch(undefined, 0)).toBeNull();
  });
});
