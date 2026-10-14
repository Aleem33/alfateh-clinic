import type { PendingPurchaseReturn } from './offlinePurchaseReturnsOutbox';

type MedicineState = { id: string; [key: string]: any } | null;

export function buildPurchaseReturnRecoveryPlan(
  record: PendingPurchaseReturn,
  medicine: MedicineState,
  recoveredAt: string,
) {
  const requestedUnits = Math.max(0, Number(record.totalUnits) || 0);
  const requestedBonusUnits = Math.min(requestedUnits, Math.max(0, Number(record.bonusUnits) || 0));
  const requestedPaidUnits = requestedUnits - requestedBonusUnits;
  const stock = Number(medicine?.stock);
  const bonusStock = Number(medicine?.bonusStockUnits || 0);
  const validStock = Boolean(medicine) && Number.isFinite(stock) && Number.isFinite(bonusStock)
    && stock >= 0 && bonusStock >= 0 && bonusStock <= stock;
  const availableBonusUnits = validStock ? bonusStock : 0;
  const availablePaidUnits = validStock ? stock - bonusStock : 0;
  const appliedPaidUnits = Math.min(requestedPaidUnits, availablePaidUnits);
  const appliedBonusUnits = Math.min(requestedBonusUnits, availableBonusUnits);
  const appliedUnits = appliedPaidUnits + appliedBonusUnits;
  const discrepancy = appliedPaidUnits !== requestedPaidUnits || appliedBonusUnits !== requestedBonusUnits
    ? {
      medicineId: record.medicineId,
      medicineName: record.returnData.medicineName || medicine?.name || 'Medicine',
      batchNo: record.returnData.batchNo || medicine?.batchNo || '',
      requestedUnits,
      requestedPaidUnits,
      requestedBonusUnits,
      appliedUnits,
      appliedPaidUnits,
      appliedBonusUnits,
      unappliedUnits: requestedUnits - appliedUnits,
      unappliedPaidUnits: requestedPaidUnits - appliedPaidUnits,
      unappliedBonusUnits: requestedBonusUnits - appliedBonusUnits,
      reason: !medicine ? 'missing-batch' : !validStock ? 'invalid-stock' : 'stock-shortage',
      status: 'pending',
    }
    : null;
  return {
    returnData: {
      ...record.returnData,
      offlineRecoveredAt: recoveredAt,
      stockAppliedUnits: appliedUnits,
      stockUnappliedUnits: requestedUnits - appliedUnits,
      stockReconciliation: discrepancy ? [discrepancy] : [],
    },
    medicineUpdate: validStock ? {
      stock: stock - appliedUnits,
      bonusStockUnits: bonusStock - appliedBonusUnits,
    } : null,
    discrepancy,
  };
}
