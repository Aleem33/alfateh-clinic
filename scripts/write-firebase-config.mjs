/**
 * Writes firebase-applet-config.json from environment variables (CI / local).
 * Required: FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID,
 *           FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID
 * Optional: FIREBASE_MEASUREMENT_ID, FIREBASE_FIRESTORE_DATABASE_ID
 */
import { writeFileSync } from 'node:fs';

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
  console.error('Missing Firebase env vars:', missing.join(', '));
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
