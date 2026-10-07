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

