import { cartItemUnits } from './billingCart';

export type SalesBreakdownLine = {
  sale: any;
  item: any;
  medicineKey: string;
  medicineName: string;
  supplierKey: string;
  supplierName: string;
  batchNo: string;
  units: number;
  amount: number;
};

export type MedicineSalesSummary = {
  key: string;
  medicineName: string;
  supplierName: string;
  batchNo: string;
  units: number;
  amount: number;
  receiptCount: number;
};

export type SupplierSalesSummary = {
  key: string;
  supplierName: string;
  medicineCount: number;
  units: number;
  amount: number;
  receiptCount: number;
};

function text(value: unknown) {
  return String(value || '').trim();
}

function normalized(value: unknown) {
  return text(value).toLocaleLowerCase();
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function recordedItemTotal(item: any) {
  if (item.total != null && Number.isFinite(Number(item.total))) return Math.max(0, Number(item.total));
  return Math.max(0, finite(item.quantity) * finite(item.price));
}

export function saleBreakdownLines(sales: any[]): SalesBreakdownLine[] {
  return sales.flatMap(sale => {
    const items = Array.isArray(sale.items) ? sale.items : [];
    const itemSubtotal = items.reduce((sum: number, item: any) => sum + recordedItemTotal(item), 0);
    const saleTotal = Math.max(0, finite(sale.total));
    return items.map((item: any) => {
      const medicineName = text(item.name) || 'Unnamed medicine';
      const supplierName = text(item.supplierName) || 'Unknown supplier';
      const batchNo = text(item.batchNo) || 'N/A';
      const medicineKey = text(item.medicineId) || `legacy:${normalized(medicineName)}|${normalized(supplierName)}|${normalized(batchNo)}`;
      const supplierKey = text(item.supplierId) || normalized(supplierName) || 'unknown supplier';
      const itemTotal = recordedItemTotal(item);
      const amount = itemSubtotal > 0 ? saleTotal * (itemTotal / itemSubtotal) : 0;
      return {
        sale,
        item,
        medicineKey,
        medicineName,
        supplierKey,
        supplierName,
        batchNo,
        units: cartItemUnits(item),
        amount,
      };
    });
  });
}

export function summarizeSalesByMedicine(lines: SalesBreakdownLine[]): MedicineSalesSummary[] {
  const groups = new Map<string, MedicineSalesSummary & { receiptIds: Set<string> }>();
  for (const line of lines) {
    const current = groups.get(line.medicineKey) || {
      key: line.medicineKey,
      medicineName: line.medicineName,
      supplierName: line.supplierName,
      batchNo: line.batchNo,
      units: 0,
      amount: 0,
      receiptCount: 0,
      receiptIds: new Set<string>(),
    };
    current.units += line.units;
    current.amount += line.amount;
    current.receiptIds.add(String(line.sale.id || line.sale.receiptNo || ''));
    groups.set(line.medicineKey, current);
  }
  return [...groups.values()].map(({ receiptIds, ...summary }) => ({
    ...summary,
    receiptCount: receiptIds.size,
  })).sort((left, right) => right.amount - left.amount || left.medicineName.localeCompare(right.medicineName));
}

export function summarizeSalesBySupplier(lines: SalesBreakdownLine[]): SupplierSalesSummary[] {
  const groups = new Map<string, SupplierSalesSummary & { medicineIds: Set<string>; receiptIds: Set<string> }>();
  for (const line of lines) {
    const current = groups.get(line.supplierKey) || {
      key: line.supplierKey,
      supplierName: line.supplierName,
      medicineCount: 0,
      units: 0,
      amount: 0,
      receiptCount: 0,
      medicineIds: new Set<string>(),
      receiptIds: new Set<string>(),
    };
    current.units += line.units;
    current.amount += line.amount;
    current.medicineIds.add(line.medicineKey);
    current.receiptIds.add(String(line.sale.id || line.sale.receiptNo || ''));
    groups.set(line.supplierKey, current);
  }
  return [...groups.values()].map(({ medicineIds, receiptIds, ...summary }) => ({
    ...summary,
    medicineCount: medicineIds.size,
    receiptCount: receiptIds.size,
  })).sort((left, right) => right.amount - left.amount || left.supplierName.localeCompare(right.supplierName));
}
