import { collection, doc, runTransaction } from '@/lib/firestore';
import { db } from '../../firebase';
import { getActiveAuthSession } from '../../lib/offlineAuth';
import { trustedNowISO } from '../../lib/trustedClock';

export async function reconcileRecoveredStock(issueId: string, stock: number, bonus: number, note: string) {
  const profile = getActiveAuthSession()?.profile;
  if (profile?.role !== 'admin') throw new Error('Only an admin can reconcile physical stock.');
  if (!Number.isInteger(stock) || !Number.isInteger(bonus) || stock < 0 || bonus < 0 || bonus > stock || !note.trim()) {
    throw new Error('Enter the counted total and bonus units, and a reconciliation note.');
  }
  const movementRef = doc(collection(db, 'stockMovements'));
  await runTransaction(db, async transaction => {
    const issueRef = doc(db, 'syncIssues', issueId);
    const issueSnapshot = await transaction.get(issueRef);
    const issue = issueSnapshot.data();
    const isSale = issue?.type === 'sale-stock-reconciliation';
    const isPurchaseReturn = issue?.type === 'purchase-return-stock-reconciliation';
    if (!issue || (!isSale && !isPurchaseReturn)) throw new Error('Stock reconciliation issue not found.');
    if (issue.status === 'resolved') return;
    const medicineRef = doc(db, 'medicines', issue.medicineId);
    const businessRef = isSale
      ? doc(db, 'sales', issue.saleId)
      : doc(db, 'purchaseReturns', issue.purchaseReturnId);
    const [medicine, businessRecord] = await Promise.all([transaction.get(medicineRef), transaction.get(businessRef)]);
    if (!medicine.exists() || !businessRecord.exists()) {
      throw new Error(`Restore the original batch and ${isSale ? 'sale' : 'purchase return'} before reconciling stock.`);
    }
    const resolvedAt = trustedNowISO();
    const resolution = { resolvedAt, resolvedBy: profile.uid, resolutionNote: note.trim(), countedStock: stock, countedBonusStock: bonus };
    transaction.update(medicineRef, { stock, bonusStockUnits: bonus });
    transaction.update(issueRef, { status: 'resolved', ...resolution });
    transaction.update(businessRef, {
      stockReconciliation: (businessRecord.data()?.stockReconciliation || []).map((entry: any) => (
        isSale ? entry.movementId === issue.movementId : entry.medicineId === issue.medicineId
      ) ? { ...entry, status: 'resolved', ...resolution } : entry),
    });
    transaction.set(movementRef, {
      type: isSale ? 'stock-reconciliation' : 'purchase-return-stock-reconciliation',
      medicineId: issue.medicineId, medicineName: issue.medicineName,
      ...(isSale
        ? { saleId: issue.saleId, receiptNo: issue.receiptNo }
        : { purchaseReturnId: issue.purchaseReturnId, returnNo: issue.returnNo }),
      syncIssueId: issueId,
      quantity: stock - Number(medicine.data()?.stock || 0),
      bonusUnits: bonus - Number(medicine.data()?.bonusStockUnits || 0),
      previousStock: Number(medicine.data()?.stock || 0),
      ...resolution, createdAt: resolvedAt,
    });
  });
}

export const reconcileRecoveredSaleStock = reconcileRecoveredStock;
