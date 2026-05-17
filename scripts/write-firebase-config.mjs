/**
 * Writes firebase-applet-config.json from environment variables (CI / local).
 *
 * Option A — one secret (easiest for GitHub Actions):
 *   FIREBASE_CONFIG_JSON = full JSON from firebase-applet-config.json (one line is fine)
 *
 * Option B — separate secrets:
 *   FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID,
 *   FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID
 *   Optional: FIREBASE_MEASUREMENT_ID, FIREBASE_FIRESTORE_DATABASE_ID
 */
import { writeFileSync } from 'node:fs';

const jsonBlob = process.env.FIREBASE_CONFIG_JSON?.trim();
if (jsonBlob) {
  let config;
  try {
    config = JSON.parse(jsonBlob);
  } catch {
    console.error('FIREBASE_CONFIG_JSON is not valid JSON.');
    process.exit(1);
  }
  const requiredFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
  const missingFields = requiredFields.filter((k) => !config[k]);
  if (missingFields.length) {
    console.error('FIREBASE_CONFIG_JSON missing fields:', missingFields.join(', '));
    process.exit(1);
  }
  if (!config.firestoreDatabaseId) config.firestoreDatabaseId = '(default)';
  writeFileSync('firebase-applet-config.json', `${JSON.stringify(config, null, 2)}\n`);
  console.log('Wrote firebase-applet-config.json from FIREBASE_CONFIG_JSON');
  process.exit(0);
}

const required = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
];

const missing = required.filter((k) => !process.env[k]?.trim());
if (missing.length) {
  console.error('');
  console.error('Firebase config is not set for GitHub Actions.');
  console.error('');
  console.error('Add ONE of these in GitHub → Settings → Secrets and variables → Actions:');
  console.error('  • FIREBASE_CONFIG_JSON  (paste full firebase-applet-config.json)');
  console.error('  • OR separate secrets:', required.join(', '));
  console.error('');
  process.exit(1);
}

const config = {
  apiKey: process.env.FIREBASE_API_KEY.trim(),
  authDomain: process.env.FIREBASE_AUTH_DOMAIN.trim(),
  projectId: process.env.FIREBASE_PROJECT_ID.trim(),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET.trim(),
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID.trim(),
  appId: process.env.FIREBASE_APP_ID.trim(),
  measurementId: process.env.FIREBASE_MEASUREMENT_ID?.trim() || '',
  firestoreDatabaseId: process.env.FIREBASE_FIRESTORE_DATABASE_ID?.trim() || '(default)',
};

writeFileSync('firebase-applet-config.json', `${JSON.stringify(config, null, 2)}\n`);
console.log('Wrote firebase-applet-config.json');
