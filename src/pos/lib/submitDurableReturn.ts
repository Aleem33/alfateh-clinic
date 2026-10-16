import { confirmRecoveredDocument, doc, getDocFromServer } from '@/lib/firestore';
import { db } from '../../firebase';
import { beginDurableSubmission, endDurableSubmission } from '../../lib/durableReplay';
import { isCloudOnline } from '../../lib/lanCoordinator';
import { upsertLocalRecords } from '../../lib/localMirror';
import { waitForSyncStep } from '../../lib/syncTiming';

/** The queue must be persisted before invoking the write; SDK acknowledgement
 * and a later connectivity flag are different facts. Keep the recovery copy
 * until an exact server read confirms it without a pending local overlay. */
export async function submitDurableReturn(options: {
  collection: 'saleReturns' | 'purchaseReturns';
  id: string;
  queue: () => Promise<void>;
  commit: () => Promise<void>;
  remove: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  beginDurableSubmission(options.collection, options.id);
  let pending: Promise<boolean> | undefined;
  try {
    await options.queue();
    pending = (async () => {
      await options.commit();
      if (!isCloudOnline()) return false;
      const confirmed = await getDocFromServer(doc(db, options.collection, options.id));
      if (!confirmed.exists() || confirmed.metadata.hasPendingWrites) return false;
      await upsertLocalRecords(options.collection, [{ id: options.id, data: confirmed.data(), pending: false }]);
      confirmRecoveredDocument(doc(db, options.collection, options.id), confirmed.data());
      await options.remove();
      return true;
    })();
    try {
      return await waitForSyncStep(pending, 8_000, 'Return confirmation');
    } catch (error) {
      options.onError(error);
      return false;
    }
  } finally {
    if (pending) void pending.then(
      () => endDurableSubmission(options.collection, options.id),
      () => endDurableSubmission(options.collection, options.id),
    );
    else endDurableSubmission(options.collection, options.id);
  }
}
