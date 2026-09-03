import { calculateNetSalesProfit } from './saleReturn';

type SaleItem = {
  quantity?: unknown;
  sellType?: unknown;
  unitsPerBox?: unknown;
  costPrice?: unknown;
  costTotal?: unknown;
};

export type FinancialSale = {
  total?: unknown;
  amountPaid?: unknown;
  items?: SaleItem[];
};

export type FinancialReturn = {
  totalRefund?: unknown;
  items?: Array<{
    returnQty?: number;
    sellType?: 'box' | 'unit';
    unitsPerBox?: number;
    costPrice?: number;
    costTotal?: number;
  }>;
};

export function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function nonNegativeNumber(value: unknown): number {
  return Math.max(0, finiteNumber(value));
}

export function sumFinancialValues<T>(records: T[], getValue: (record: T) => unknown): number {
  return records.reduce((sum, record) => sum + nonNegativeNumber(getValue(record)), 0);
}

export function calculateSaleCost(sale: FinancialSale): number {
  return (sale.items || []).reduce((sum, item) => {
    if (item.costTotal != null && Number.isFinite(Number(item.costTotal))) {
      return sum + nonNegativeNumber(item.costTotal);
    }
    const quantity = nonNegativeNumber(item.quantity);
    const unitsPerBox = Math.max(1, nonNegativeNumber(item.unitsPerBox) || 1);
    const costPerBox = nonNegativeNumber(item.costPrice);
    const unitsSold = quantity * (item.sellType === 'box' ? unitsPerBox : 1);
    return sum + (costPerBox / unitsPerBox) * unitsSold;
  }, 0);
}

export function summarizeSalesFinancials(
  sales: FinancialSale[] = [],
  returns: FinancialReturn[] = [],
  expenses: unknown = 0,
) {
  const grossRevenue = sumFinancialValues(sales, sale => sale.total);
  const grossCollected = sales.reduce((sum, sale) => {
    const paid = sale.amountPaid == null ? sale.total : sale.amountPaid;
    return sum + nonNegativeNumber(paid);
  }, 0);
  const grossCost = sales.reduce((sum, sale) => sum + calculateSaleCost(sale), 0);
  const operatingExpenses = nonNegativeNumber(expenses);
  const normalizedReturns = returns.map(entry => ({
    ...entry,
    totalRefund: nonNegativeNumber(entry.totalRefund),
  }));
  const profit = calculateNetSalesProfit(grossRevenue, grossCost, normalizedReturns, operatingExpenses);

  return {
    grossRevenue,
    grossCollected,
    grossCost,
    operatingExpenses,
    ...profit,
    netCollected: grossCollected - profit.refunds,
  };
}

export function netSalesByDate<TSale extends FinancialSale, TReturn extends FinancialReturn>(
  sales: TSale[],
  returns: TReturn[],
  getDateKey: (record: TSale | TReturn) => string,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const sale of sales) {
    const key = getDateKey(sale);
    if (key) totals.set(key, (totals.get(key) || 0) + nonNegativeNumber(sale.total));
  }
  for (const entry of returns) {
    const key = getDateKey(entry);
    if (key) totals.set(key, (totals.get(key) || 0) - nonNegativeNumber(entry.totalRefund));
  }
  return totals;
}
