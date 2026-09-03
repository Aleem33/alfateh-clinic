export type PurchaseInvoiceLineIdentity = {
  medicineId: string;
  medicineName: string;
  batchMode: 'existing' | 'new';
  batchNo: string;
  supplierId?: string;
  supplierName?: string;
};

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function calculatePurchaseQuantities(
  boxes: unknown,
  looseUnits: unknown,
  unitsPerBox: unknown,
  costPricePerBox: unknown,
  bonusBoxes: unknown = 0,
  bonusLooseUnits: unknown = 0,
) {
  const boxCount = Math.max(0, Math.floor(Number(boxes) || 0));
  const looseCount = Math.max(0, Math.floor(Number(looseUnits) || 0));
  const bonusBoxCount = Math.max(0, Math.floor(Number(bonusBoxes) || 0));
  const bonusLooseCount = Math.max(0, Math.floor(Number(bonusLooseUnits) || 0));
  const packSize = Math.max(1, Math.floor(Number(unitsPerBox) || 1));
  const costPerBox = Math.max(0, Number(costPricePerBox) || 0);
  const paidUnits = (boxCount * packSize) + looseCount;
  const bonusUnits = (bonusBoxCount * packSize) + bonusLooseCount;
  const totalUnits = paidUnits + bonusUnits;
  const costPricePerUnit = costPerBox / packSize;

  return {
    boxesPurchased: boxCount,
    looseUnitsPurchased: looseCount,
    paidBoxesPurchased: boxCount,
    paidLooseUnitsPurchased: looseCount,
    bonusBoxes: bonusBoxCount,
    bonusLooseUnits: bonusLooseCount,
    unitsPerBox: packSize,
    paidUnits,
    bonusUnits,
    totalUnits,
    costPrice: costPerBox,
    costPricePerUnit,
    totalCost: paidUnits * costPricePerUnit,
  };
}

export function getPurchaseInvoiceLineKey(line: PurchaseInvoiceLineIdentity): string {
  if (line.batchMode === 'existing') return `existing:${line.medicineId}`;
  return [
    'new',
    normalize(line.medicineName),
    normalize(line.batchNo),
    normalize(line.supplierId || line.supplierName),
  ].join('|');
}

export function hasDuplicatePurchaseInvoiceLine(
  lines: PurchaseInvoiceLineIdentity[],
  candidate: PurchaseInvoiceLineIdentity,
): boolean {
  const candidateKey = getPurchaseInvoiceLineKey(candidate);
  return lines.some(line => getPurchaseInvoiceLineKey(line) === candidateKey);
}

export function validateExistingBatchPurchase(
  proposed: { unitsPerBox: number; retailPrice: number },
  existing: { unitsPerBox?: number; retailPrice?: number; price?: number },
): string {
  const existingUnits = Math.max(1, Number(existing.unitsPerBox || 1));
  const existingRetail = Number(existing.retailPrice || existing.price || 0);
  if (proposed.unitsPerBox !== existingUnits || Math.abs(proposed.retailPrice - existingRetail) > 0.001) {
    return 'Pack size and retail price are locked for an existing batch. Choose New Batch to change either one.';
  }
  return '';
}

export function getEditedBatchSellingPriceUpdate(
  edited: { retailPrice: number; unitPrice: number },
  original: { retailPrice?: number; price?: number; unitPrice?: number },
): { retailPrice?: number; price?: number; unitPrice?: number } {
  const originalRetail = Number(original.retailPrice ?? original.price ?? 0);
  const originalUnit = Number(original.unitPrice ?? 0);
  const retailChanged = Math.abs(edited.retailPrice - originalRetail) > 0.001;
  const unitChanged = Math.abs(edited.unitPrice - originalUnit) > 0.001;
  if (!retailChanged && !unitChanged) return {};
  return {
    retailPrice: edited.retailPrice,
    price: edited.retailPrice,
    unitPrice: edited.unitPrice,
  };
}
