import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createOfflineCredentialVault } = require('../../offlineCredentialVault.js');

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

describe('offline credential vault', () => {
  let directory: string;
  let safeStorage: ReturnType<typeof testSafeStorage>;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alfateh-offline-auth-'));
    safeStorage = testSafeStorage();
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('enrolls an online user and verifies the password without plaintext on disk', () => {
    const vault = createOfflineCredentialVault({ userDataPath: directory, safeStorage });
    vault.enroll({
      username: 'Admin User',
      password: 'correct horse battery staple',
      profile: { uid: 'uid-1', username: 'admin.user', email: 'admin.user@example.test', role: 'admin' },
    });

    expect(vault.verify('admin user', 'correct horse battery staple')).toMatchObject({
      ok: true,
      profile: { uid: 'uid-1', username: 'admin.user', role: 'admin', active: true },
    });
    expect(vault.verify('admin.user', 'wrong password')).toEqual({ ok: false, reason: 'invalid-credential' });
    const persisted = fs.readFileSync(path.join(directory, 'offline-credentials.vault')).toString('utf8');
    expect(persisted).not.toContain('correct horse battery staple');
    expect(persisted).not.toContain('admin.user@example.test');
  });

  it('persists refreshed permissions and revokes removed accounts', () => {
    const vault = createOfflineCredentialVault({ userDataPath: directory, safeStorage });
    vault.enroll({
      username: 'cashier',
      password: 'secret-123',
      profile: { uid: 'uid-2', username: 'cashier', email: 'cashier@example.test', role: 'cashier' },
    });
    expect(vault.updateProfile({
      uid: 'uid-2', username: 'cashier', email: 'cashier@example.test', role: 'pharmacist', permissions: ['billing', 'inventory'], active: true,
    })).toBe(true);

    const reopened = createOfflineCredentialVault({ userDataPath: directory, safeStorage });
    expect(reopened.verify('cashier', 'secret-123')).toMatchObject({
      ok: true,
      profile: { role: 'pharmacist', permissions: ['billing', 'inventory'] },
    });
    expect(reopened.revoke('cashier')).toBe(true);
    expect(reopened.verify('cashier', 'secret-123')).toEqual({ ok: false, reason: 'not-enrolled' });
  });

  it('throttles repeated incorrect offline login attempts', () => {
    const vault = createOfflineCredentialVault({ userDataPath: directory, safeStorage });
    vault.enroll({
      username: 'doctor', password: 'secret-123', profile: { uid: 'uid-4', username: 'doctor', role: 'doctor' },
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(vault.verify('doctor', 'incorrect')).toMatchObject({ ok: false, reason: 'invalid-credential' });
    }
    expect(vault.verify('doctor', 'secret-123')).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('refuses enrollment when operating-system encryption is unavailable', () => {
    const vault = createOfflineCredentialVault({
      userDataPath: directory,
      safeStorage: { isEncryptionAvailable: () => false },
    });
    expect(() => vault.enroll({
      username: 'admin', password: 'secret-123', profile: { uid: 'uid-3', username: 'admin', role: 'admin' },
    })).toThrow(/encryption is unavailable/i);
  });
});
