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
) {
  const boxCount = Math.max(0, Math.floor(Number(boxes) || 0));
  const looseCount = Math.max(0, Math.floor(Number(looseUnits) || 0));
  const packSize = Math.max(1, Math.floor(Number(unitsPerBox) || 1));
  const costPerBox = Math.max(0, Number(costPricePerBox) || 0);
  const totalUnits = (boxCount * packSize) + looseCount;
  const costPricePerUnit = costPerBox / packSize;

  return {
    boxesPurchased: boxCount,
    looseUnitsPurchased: looseCount,
    unitsPerBox: packSize,
    totalUnits,
    costPrice: costPerBox,
    costPricePerUnit,
    totalCost: totalUnits * costPricePerUnit,
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
