export type BonusAwareMedicine = {
  id: string;
  stock?: unknown;
  bonusStockUnits?: unknown;
  costPrice?: unknown;
  unitsPerBox?: unknown;
};

export type BonusAwareSaleItem = {
  medicineId?: string;
  quantity?: unknown;
  sellType?: unknown;
  unitsPerBox?: unknown;
  costPrice?: unknown;
  [key: string]: unknown;
};

const nonNegative = (value: unknown) => Math.max(0, Number(value) || 0);

export function getMedicineStockBuckets(medicine: BonusAwareMedicine) {
  const stock = nonNegative(medicine.stock);
  const bonusStockUnits = Math.min(stock, nonNegative(medicine.bonusStockUnits));
  return { stock, bonusStockUnits, paidStockUnits: stock - bonusStockUnits };
}

export function allocatePaidFirst(units: unknown, paidAvailable: unknown, bonusAvailable: unknown) {
  const requestedUnits = nonNegative(units);
  const paidUnits = Math.min(requestedUnits, nonNegative(paidAvailable));
  const bonusUnits = Math.min(requestedUnits - paidUnits, nonNegative(bonusAvailable));
  return { paidUnits, bonusUnits, totalUnits: paidUnits + bonusUnits };
}

export function allocateCartBonusCost<T extends BonusAwareSaleItem>(
  items: T[],
  medicines: BonusAwareMedicine[],
) {
  const remaining = new Map(medicines.map(medicine => {
    const buckets = getMedicineStockBuckets(medicine);
    return [medicine.id, { ...buckets, medicine }];
  }));

  return items.map(item => {
    const unitsPerBox = Math.max(1, Number(item.unitsPerBox) || 1);
    const requestedUnits = nonNegative(item.quantity) * (item.sellType === 'box' ? unitsPerBox : 1);
    const state = item.medicineId ? remaining.get(item.medicineId) : undefined;
    const allocation = allocatePaidFirst(requestedUnits, state?.paidStockUnits, state?.bonusStockUnits);
    if (state) {
      state.paidStockUnits -= allocation.paidUnits;
      state.bonusStockUnits -= allocation.bonusUnits;
      state.stock -= allocation.totalUnits;
    }
    const costPerBox = nonNegative(item.costPrice ?? state?.medicine.costPrice);
    const costPerUnit = costPerBox / unitsPerBox;
    return {
      ...item,
      paidUnitsSold: allocation.paidUnits,
      bonusUnitsSold: allocation.bonusUnits,
      costTotal: allocation.paidUnits * costPerUnit,
    };
  });
}

export function getBonusAwareStockValue(medicine: BonusAwareMedicine) {
  const { paidStockUnits } = getMedicineStockBuckets(medicine);
  const unitsPerBox = Math.max(1, Number(medicine.unitsPerBox) || 1);
  return paidStockUnits * (nonNegative(medicine.costPrice) / unitsPerBox);
}

export function allocateReceiptReturn(
  returnedUnits: unknown,
  previouslyReturnedUnits: unknown,
  paidUnitsSold: unknown,
  bonusUnitsSold: unknown,
) {
  const units = nonNegative(returnedUnits);
  const previous = nonNegative(previouslyReturnedUnits);
  const soldBonus = nonNegative(bonusUnitsSold);
  const soldPaid = nonNegative(paidUnitsSold);
  const bonusPreviouslyRestored = Math.min(previous, soldBonus);
  const bonusUnitsRestored = Math.min(units, Math.max(0, soldBonus - bonusPreviouslyRestored));
  const paidPreviouslyRestored = Math.max(0, previous - soldBonus);
  const paidUnitsRestored = Math.min(units - bonusUnitsRestored, Math.max(0, soldPaid - paidPreviouslyRestored));
  return { paidUnitsRestored, bonusUnitsRestored };
}
