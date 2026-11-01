type RecordData = Record<string, any>;
const units = (value: unknown) => Math.max(0, Number(value) || 0);

export function purchaseUnitBuckets(purchase: RecordData) {
  const bonus = units(purchase.bonusUnits);
  const explicitTotal = purchase.totalUnitsAdded ?? purchase.unitsAdded;
  const total = explicitTotal != null ? units(explicitTotal)
    : purchase.paidUnits != null ? units(purchase.paidUnits) + bonus
      : units(purchase.boxesPurchased ?? purchase.boxes) * Math.max(1, units(purchase.unitsPerBox))
        + units(purchase.looseUnitsPurchased ?? purchase.looseUnits) + bonus;
  const paid = purchase.paidUnits != null ? units(purchase.paidUnits) : Math.max(0, total - bonus);
  return { paid, bonus, total };
}

export function returnedPurchaseBuckets(purchaseId: string, returns: RecordData[]) {
  return returns.filter(row => row.originalPurchaseId === purchaseId && row.deleted !== true)
    .reduce((sum, row) => {
      const bonus = units(row.bonusUnitsReturned);
      const total = units(row.totalUnitsReturned ?? row.unitsReturned
        ?? (units(row.paidUnitsReturned) + bonus));
      return {
        paid: sum.paid + units(row.paidUnitsReturned ?? Math.max(0, total - bonus)),
        bonus: sum.bonus + bonus,
        total: sum.total + total,
      };
    }, { paid: 0, bonus: 0, total: 0 });
}

export function validatePurchaseEditAgainstReturns(
  original: RecordData, proposed: { paidUnits: number; bonusUnits: number }, returns: RecordData[],
) {
  const before = purchaseUnitBuckets(original);
  // Allow cost/metadata repairs on already inconsistent legacy records. Never
  // silently rewrite their old return quantities to make an edit fit.
  if (before.paid === proposed.paidUnits && before.bonus === proposed.bonusUnits) return '';
  const returned = returnedPurchaseBuckets(original.id, returns);
  if (proposed.paidUnits < returned.paid || proposed.bonusUnits < returned.bonus) {
    return `This purchase already has ${returned.paid} paid and ${returned.bonus} bonus units returned. `
      + 'Its quantities cannot be reduced below those returns. To correct a physical count, ask an admin to edit the batch stock in Medicines; do not change purchase history or create a supplier return unless goods were actually returned.';
  }
  return '';
}

export function purchaseReturnBlockReason(purchase: RecordData, medicine: RecordData | undefined, returns: RecordData[]) {
  if (!medicine || medicine.deleted === true) return 'The original medicine batch could not be identified safely. Ask an admin to check the purchase link; no stock has been changed.';
  if (medicine.archived === true) return 'This batch is archived. An admin must review and restore it before a supplier return.';
  const purchased = purchaseUnitBuckets(purchase);
  const returned = returnedPurchaseBuckets(purchase.id, returns);
  if (returned.paid > purchased.paid || returned.bonus > purchased.bonus) {
    return `This purchase now records ${purchased.paid} paid and ${purchased.bonus} bonus units, but ${returned.paid} paid and ${returned.bonus} bonus units were already returned. `
      + 'Ask an admin to review the original purchase. Use Medicines to correct a verified physical count; a supplier return is only for goods actually sent back. Existing records are preserved.';
  }
  return '';
}
