import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { waitForOnlineWrite } from '../../lib/offlineWrite';

// ── Audit Log ────────────────────────────────────────────────
export async function logAudit(
  action: string,
  entity: string,
  entityId: string,
  detail?: string
) {
  try {
    await waitForOnlineWrite(addDoc(collection(db, 'auditLogs'), {
      action,         // 'create' | 'update' | 'delete' | 'login' | 'print'
      entity,         // 'patient' | 'bill' | 'staff' | ...
      entityId,
      detail: detail || '',
      userId: auth.currentUser?.uid || 'system',
      userEmail: auth.currentUser?.email || 'system',
      timestamp: new Date().toISOString(),
      createdAt: serverTimestamp(),
    }));
  } catch (e) {
    // Audit logging should never crash the app
    console.warn('Audit log failed:', e);
  }
}

// ── In-app Notifications ─────────────────────────────────────
export async function createNotification(
  title: string,
  body: string,
  type: 'info' | 'warning' | 'success' | 'error' = 'info',
  link?: string
) {
  try {
    await waitForOnlineWrite(addDoc(collection(db, 'notifications'), {
      title,
      body,
      type,
      link: link || '',
      read: false,
      createdAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.warn('Notification creation failed:', e);
  }
}
