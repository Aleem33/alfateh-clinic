const positive = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const nonNegative = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export function resolvePurchaseUnitCost(purchase?: Record<string, any> | null): number {
  if (!purchase) return 0;

  const frozenUnitCost = positive(purchase.costPricePerUnit);
  if (frozenUnitCost > 0) return frozenUnitCost;

  const paidUnits = positive(purchase.paidUnits)
    || Math.max(0, nonNegative(purchase.totalUnitsAdded ?? purchase.unitsAdded) - nonNegative(purchase.bonusUnits));
  const payable = positive(purchase.totalCost ?? purchase.payableAmount);
  if (paidUnits > 0 && payable > 0) return payable / paidUnits;

  const unitsPerBox = Math.max(1, positive(purchase.unitsPerBox) || 1);
  const costPerBox = positive(purchase.costPrice ?? purchase.costPerBox ?? purchase.purchasePrice);
  return costPerBox > 0 ? costPerBox / unitsPerBox : 0;
}

export function resolvePurchaseReturnFinancials(
  purchaseReturn: Record<string, any>,
  originalPurchase?: Record<string, any> | null,
  linkedMedicine?: Record<string, any> | null,
) {
  const paidUnitsReturned = nonNegative(
    purchaseReturn.paidUnitsReturned ?? purchaseReturn.totalUnitsReturned ?? purchaseReturn.unitsReturned,
  );
  const storedRefund = positive(
    purchaseReturn.refundAmount ?? purchaseReturn.totalRefund ?? purchaseReturn.returnAmount,
  );
  const unitCost = resolvePurchaseUnitCost(purchaseReturn)
    || resolvePurchaseUnitCost(originalPurchase)
    || resolvePurchaseUnitCost(linkedMedicine);

  return {
    paidUnitsReturned,
    costPricePerUnit: unitCost,
    refundAmount: storedRefund || paidUnitsReturned * unitCost,
    reconstructed: storedRefund <= 0 && paidUnitsReturned > 0 && unitCost > 0,
  };
}

/**
 * Resolve the original batch without guessing across different batches. Old
 * return rows can point at an archived batch, or can predate a stable medicine
 * ID. Exact IDs win; the legacy fallback is accepted only when name plus any
 * available batch/supplier identity leaves one unambiguous medicine record.
 */
export function findPurchaseReturnMedicine(
  purchaseReturn: Record<string, any>,
  originalPurchase: Record<string, any> | null | undefined,
  medicines: Array<Record<string, any>>,
): Record<string, any> | undefined {
  const candidateIds = [
    purchaseReturn.medicineId,
    originalPurchase?.medicineId,
  ].filter(Boolean).map(String);

  for (const id of candidateIds) {
    const exact = medicines.find(medicine => String(medicine.id) === id);
    if (exact) return exact;
  }

  const targetName = normalizeMedicineText(
    purchaseReturn.medicineName || originalPurchase?.medicineName,
  );
  if (!targetName) return undefined;

  let matches = medicines.filter(medicine => normalizeMedicineText(medicine.name) === targetName);
  const narrow = (target: unknown, getValue: (medicine: Record<string, any>) => unknown) => {
    const normalizedTarget = normalizeMedicineText(target);
    if (!normalizedTarget) return;
    matches = matches.filter(medicine => normalizeMedicineText(getValue(medicine)) === normalizedTarget);
  };

  narrow(purchaseReturn.batchNo || originalPurchase?.batchNo, medicine => medicine.batchNo);
  narrow(purchaseReturn.supplierId || originalPurchase?.supplierId, medicine => medicine.supplierId);
  narrow(purchaseReturn.supplierName || originalPurchase?.supplierName, medicine => medicine.supplierName);

  return matches.length === 1 ? matches[0] : undefined;
}

import { normalizeMedicineText } from '../../lib/medicineIndex';

