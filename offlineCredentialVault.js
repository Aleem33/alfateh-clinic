const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VAULT_VERSION = 1;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase().replace(/\s+/g, '.');
}

function passwordHash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64, SCRYPT_OPTIONS);
}

function sanitizeProfile(profile = {}) {
  const permissions = Array.isArray(profile.permissions)
    ? profile.permissions.slice(0, 100).map(value => String(value).slice(0, 100))
    : (profile.permissions && typeof profile.permissions === 'object'
      ? Object.fromEntries(Object.entries(profile.permissions).slice(0, 100).map(([key, value]) => [String(key).slice(0, 100), Boolean(value)]))
      : []);
  return {
    uid: String(profile.uid || '').slice(0, 160),
    username: normalizeUsername(profile.username || profile.email?.split('@')[0] || '').slice(0, 128),
    email: String(profile.email || '').slice(0, 320),
    name: String(profile.name || '').slice(0, 200),
    role: String(profile.role || 'cashier').slice(0, 80),
    app: String(profile.app || '').slice(0, 40),
    permissions,
    active: profile.active !== false,
    profileUpdatedAt: String(profile.profileUpdatedAt || profile.updatedAt || new Date().toISOString()),
  };
}

function createOfflineCredentialVault({ userDataPath, safeStorage }) {
  const filePath = path.join(userDataPath, 'offline-credentials.vault');

  function encryptionAvailable() {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  }

  function readVault() {
    if (!encryptionAvailable()) return { version: VAULT_VERSION, users: {} };
    try {
      const encrypted = fs.readFileSync(filePath);
      const plain = safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(plain);
      if (parsed?.version !== VAULT_VERSION || !parsed.users || typeof parsed.users !== 'object') {
        return { version: VAULT_VERSION, users: {} };
      }
      return parsed;
    } catch {
      return { version: VAULT_VERSION, users: {} };
    }
  }

  function writeVault(vault) {
    if (!encryptionAvailable()) {
      throw new Error('Windows credential encryption is unavailable on this device. Offline login was not enabled.');
    }
    fs.mkdirSync(userDataPath, { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(vault));
    const temporaryPath = `${filePath}.tmp`;
    fs.writeFileSync(temporaryPath, encrypted, { mode: 0o600 });
    try {
      fs.renameSync(temporaryPath, filePath);
    } catch {
      fs.copyFileSync(temporaryPath, filePath);
      fs.unlinkSync(temporaryPath);
    }
  }

  function enroll({ username, password, profile }) {
    const normalized = normalizeUsername(username || profile?.username);
    const cleanProfile = sanitizeProfile({ ...profile, username: normalized });
    if (!normalized || normalized.length > 128 || !password || String(password).length > 256 || !cleanProfile.uid) {
      throw new Error('A valid online account is required for offline login enrollment.');
    }

    const salt = crypto.randomBytes(32);
    const vault = readVault();
    vault.users[normalized] = {
      profile: cleanProfile,
      salt: salt.toString('base64'),
      verifier: passwordHash(password, salt).toString('base64'),
      // The complete vault is encrypted with Electron safeStorage (Windows DPAPI).
      // This recoverable secret is used only to re-authenticate Firebase before queued writes sync.
      cloudCredential: String(password),
      enrolledAt: new Date().toISOString(),
    };
    writeVault(vault);
    return cleanProfile;
  }

  function verify(username, password) {
    const normalized = normalizeUsername(username);
    if (!normalized || normalized.length > 128 || typeof password !== 'string' || password.length > 256) {
      return { ok: false, reason: 'invalid-credential' };
    }
    const vault = readVault();
    const record = vault.users[normalized];
    if (!record?.salt || !record?.verifier || !record?.profile) return { ok: false, reason: 'not-enrolled' };
    const retryAfterMs = Number(record.lockedUntil || 0) - Date.now();
    if (retryAfterMs > 0) {
      return { ok: false, reason: 'locked', retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
    }
    try {
      const actual = passwordHash(password, Buffer.from(record.salt, 'base64'));
      const expected = Buffer.from(record.verifier, 'base64');
      const ok = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
      if (!ok) {
        record.failedAttempts = Number(record.failedAttempts || 0) + 1;
        if (record.failedAttempts >= 5) {
          const exponent = Math.min(record.failedAttempts - 5, 4);
          record.lockedUntil = Date.now() + (30_000 * (2 ** exponent));
        }
        writeVault(vault);
        return { ok: false, reason: 'invalid-credential' };
      }
      if (record.profile.active === false) return { ok: false, reason: 'disabled' };
      if (record.failedAttempts || record.lockedUntil) {
        record.failedAttempts = 0;
        record.lockedUntil = 0;
        writeVault(vault);
      }
      return { ok: true, profile: sanitizeProfile(record.profile) };
    } catch {
      return { ok: false, reason: 'invalid-credential' };
    }
  }

  function getCloudCredential(username) {
    const normalized = normalizeUsername(username);
    const record = readVault().users[normalized];
    if (!record?.cloudCredential || !record?.profile?.uid) return null;
    return {
      username: normalized,
      password: String(record.cloudCredential),
      uid: String(record.profile.uid),
    };
  }

  function updateProfile(profile) {
    const cleanProfile = sanitizeProfile(profile);
    const vault = readVault();
    const username = cleanProfile.username;
    const record = vault.users[username];
    if (!record || record.profile.uid !== cleanProfile.uid) return false;
    record.profile = cleanProfile;
    writeVault(vault);
    return true;
  }

  function revoke(username) {
    const normalized = normalizeUsername(username);
    const vault = readVault();
    if (!vault.users[normalized]) return false;
    delete vault.users[normalized];
    writeVault(vault);
    return true;
  }

  return { encryptionAvailable, enroll, verify, getCloudCredential, updateProfile, revoke };
}

module.exports = { createOfflineCredentialVault, normalizeUsername, sanitizeProfile };
