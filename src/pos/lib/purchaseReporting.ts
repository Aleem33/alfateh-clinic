import { historyDateKey } from '../../lib/monthFilter';

const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function purchaseReportLine(record: Record<string, any>) {
  const unitsPerBox = Math.max(1, number(record.unitsPerBox) || 1);
  const bonus = number(record.bonusUnits ?? (number(record.bonusBoxes) * unitsPerBox + number(record.bonusLooseUnits)));
  const total = number(record.totalUnitsAdded ?? record.unitsAdded ?? (
    number(record.boxesPurchased ?? record.boxes) * unitsPerBox + number(record.looseUnitsPurchased ?? record.looseUnits) + bonus
  ));
  const paid = number(record.paidUnits ?? Math.max(0, total - bonus));
  return {
    id: String(record.id), date: historyDateKey(record),
    invoice: String(record.invoiceId || record.id),
    medicine: String(record.medicineName || 'Unknown medicine'),
    supplier: String(record.supplierName || 'Unknown supplier'),
    supplierKey: String(record.supplierId || record.supplierName || 'unknown'),
    medicineKey: String(record.medicineId || JSON.stringify([record.medicineName, record.batchNo, record.supplierId || record.supplierName])),
    batch: String(record.batchNo || 'N/A'), paid, bonus, total,
    cost: number(record.costPrice ?? record.costPerBox), payable: number(record.totalCost),
  };
}

export type PurchaseReportLine = ReturnType<typeof purchaseReportLine>;

export function summarizePurchases(lines: PurchaseReportLine[], by: 'medicine' | 'supplier' | 'invoice') {
  const groups = new Map<string, { key: string; label: string; detail: string; lines: number; paid: number; bonus: number; total: number; payable: number }>();
  for (const line of lines) {
    const key = by === 'medicine' ? line.medicineKey : by === 'supplier' ? line.supplierKey : line.invoice;
    const current = groups.get(key) || {
      key, label: by === 'medicine' ? line.medicine : by === 'supplier' ? line.supplier : line.invoice,
      detail: by === 'medicine' ? `${line.supplier} · Batch ${line.batch}` : by === 'invoice' ? line.date : '',
      lines: 0, paid: 0, bonus: 0, total: 0, payable: 0,
    };
    current.lines++; current.paid += line.paid; current.bonus += line.bonus;
    current.total += line.total; current.payable += line.payable;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.payable - a.payable || a.label.localeCompare(b.label));
}
