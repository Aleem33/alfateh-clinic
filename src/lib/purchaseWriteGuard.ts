/** Stable identity for a purchase receipt or one edit of a known revision. */
export async function purchaseGuardId(key:string) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  return 'purchase-guard-'+Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
}

export function purchaseEditKey(purchase:Record<string,any>) {
  return `edit:${purchase.id}:${purchase.updatedAt || purchase.createdAt || JSON.stringify([purchase.totalUnitsAdded,purchase.bonusUnits,purchase.totalCost])}`;
}

export function purchasePayload(data:Record<string,any>) {
  const fields=['medicineId','medicineName','supplierId','supplierName','boxesPurchased','looseUnitsPurchased','paidUnits','bonusUnits','totalUnitsAdded','unitsPerBox','costPrice','costPerBox','costPricePerUnit','retailPrice','unitPrice','batchNo','expiryDate','totalCost','date','invoiceNo','supplierInvoiceNo','notes'];
  return JSON.stringify(fields.map(key=>[key,data[key] ?? null]));
}
