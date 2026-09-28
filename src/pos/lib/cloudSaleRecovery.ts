import { doc, getDocFromServer, increment, runTransaction } from '@/lib/firestore';
import { db } from '../../firebase';
import { trustedNowISO } from '../../lib/trustedClock';
import { recoverSaleTransaction } from './saleRecovery';
import type { PendingPosSale } from './offlineSalesOutbox';

export async function recoverPosSaleToCloud(record: PendingPosSale) {
  try {
    await runTransaction(db, transaction => recoverSaleTransaction(
      transaction, record, (collection, id) => doc(db, collection, id), increment, trustedNowISO(),
    ));
  } catch (error) {
    // A competing recovery can commit first. Staff cannot overwrite existing
    // movements, so rules may reject our stale transaction before retrying it.
    // Only an exact server-confirmed sale makes that rejection a success.
    try { if ((await getDocFromServer(doc(db, 'sales', record.saleId))).exists()) return; }
    catch { /* Preserve the original error and the durable outbox record. */ }
    throw error;
  }
}
