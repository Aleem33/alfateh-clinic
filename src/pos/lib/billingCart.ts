export type BillCartItem = {
  medicineId?: string;
  name?: string;
  quantity?: number;
  sellType?: string;
  unitsPerBox?: number;
};

export function cartItemUnits(item: BillCartItem): number {
  const quantity = Math.max(0, Number(item.quantity) || 0);
  const unitsPerBox = item.sellType === 'box'
    ? Math.max(1, Number(item.unitsPerBox) || 1)
    : 1;
  return quantity * unitsPerBox;
}

export function findCartStockProblem(items: BillCartItem[], medicines: any[]): string {
  const requiredByMedicine = new Map<string, { name: string; units: number }>();

  for (const item of items) {
    if (!item.medicineId) continue;
    const current = requiredByMedicine.get(item.medicineId) || {
      name: item.name || 'Medicine',
      units: 0,
    };
    current.units += cartItemUnits(item);
    requiredByMedicine.set(item.medicineId, current);
  }

  for (const [medicineId, required] of requiredByMedicine) {
    const medicine = medicines.find(entry => entry.id === medicineId);
    if (!medicine) return `${required.name} is no longer available in inventory.`;
    const available = Math.max(0, Number(medicine.stock) || 0);
    if (required.units > available) {
      return `${required.name} now has only ${available} units available; this bill needs ${required.units}.`;
    }
  }

  return '';
}
