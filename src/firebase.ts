/**
 * Al-Fateh Clinic — Firebase (Auth + Firestore)
 *
 * USERNAME LOGIN:
 *   Users type a username — converted internally to username@alfateh-clinic.internal
 *   No one ever sees or types an email address.
 */
import { initializeApp } from 'firebase/app';
import {
  getAuth, signInWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  increment, enableIndexedDbPersistence, runTransaction,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

// ── App instances ─────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export const storage = getStorage(app);

// Keep user logged in across sessions
setPersistence(auth, browserLocalPersistence).catch(console.error);

// Enable offline support (data cached locally when internet drops)
enableIndexedDbPersistence(db).catch(() => {
  // Fails silently if multiple tabs open — that's fine
});

// Secondary app — creates new users without logging out the current admin
const secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp');
export const secondaryAuth = getAuth(secondaryApp);

// ── Username → email conversion ───────────────────────────────────────────────
const DOMAIN = 'alfateh-clinic.internal';
export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase().replace(/\s+/g, '.')}@${DOMAIN}`;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
export const loginWithUsername = (username: string, password: string) =>
  signInWithEmailAndPassword(auth, usernameToEmail(username), password);

export const loginWithEmail = loginWithUsername;
export const logout = () => signOut(auth);

/** Create a new user account (admin stays logged in) */
export const createUser = (username: string, password: string) =>
  createUserWithEmailAndPassword(secondaryAuth, usernameToEmail(username), password);

export const registerUser          = createUser;
export const registerWithEmail     = createUser;
export const registerSecondaryUser = createUser;

// ── Auto-incrementing counters (MRN, Bill numbers) ────────────────────────────
export async function getNextMRN(): Promise<string> {
  const ref = doc(db, 'counters', 'mrn');
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { value: 1 });
    return 'MRN-00001';
  }
  await updateDoc(ref, { value: increment(1) });
  const next = (snap.data().value as number) + 1;
  return `MRN-${String(next).padStart(5, '0')}`;
}

export async function getNextBillNo(): Promise<string> {
  const ref = doc(db, 'counters', 'bill');
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { value: 1 });
    return 'BILL-00001';
  }
  await updateDoc(ref, { value: increment(1) });
  const next = (snap.data().value as number) + 1;
  return `BILL-${String(next).padStart(5, '0')}`;
}

// ── POS counter helpers ───────────────────────────────────────────────────────
async function getNextCounterNumber(counterId: string): Promise<string> {
  const ref = doc(db, 'counters', counterId);
  const next = await runTransaction(db, async transaction => {
    const snap = await transaction.get(ref);
    const current = snap.exists() ? Number(snap.data().value || 0) : 0;
    const value = current + 1;
    transaction.set(ref, { value }, { merge: true });
    return value;
  });
  return String(next).padStart(6, '0');
}

export async function getNextPosReceiptNo(): Promise<string> {
  return getNextCounterNumber('posReceipt');
}

export async function getNextPosSaleReturnNo(): Promise<string> {
  return getNextCounterNumber('posSaleReturn');
}

export async function getNextPosPurchaseReturnNo(): Promise<string> {
  return getNextCounterNumber('posPurchaseReturn');
}

// ── Firestore error handler ───────────────────────────────────────────────────
export type OperationType = 'read' | 'write' | 'delete';
export const OperationType = {
  GET:    'read'   as OperationType,
  CREATE: 'write'  as OperationType,
  UPDATE: 'write'  as OperationType,
  SET:    'write'  as OperationType,
  READ:   'read'   as OperationType,
  WRITE:  'write'  as OperationType,
  DELETE: 'delete' as OperationType,
};

export function handleFirestoreError(err: unknown, operation: OperationType = 'read', _context?: string): string {
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case 'permission-denied': return 'You do not have permission to perform this action.';
    case 'not-found':         return 'The requested record was not found.';
    case 'unavailable':       return 'Service temporarily unavailable. Please try again.';
    case 'unauthenticated':   return 'Session expired. Please log in again.';
    default:
      console.error(`Firestore ${operation} error:`, err);
      return e.message || 'An unexpected error occurred.';
  }
}

export const nowISO = () => new Date().toISOString();
