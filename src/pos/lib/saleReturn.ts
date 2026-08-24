export type ReturnSellType = 'box' | 'unit';

export function calculateReturnStockUnits(quantity: number, sellType: ReturnSellType, unitsPerBox: number) {
  const safeQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
  const safeUnitsPerBox = Math.max(1, Math.floor(Number(unitsPerBox) || 1));
  return safeQuantity * (sellType === 'box' ? safeUnitsPerBox : 1);
}

export function calculateReturnRefund(quantity: number, refundPrice: number) {
  const safeQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
  const safePrice = Math.max(0, Number(refundPrice) || 0);
  return safeQuantity * safePrice;
}

export type ReturnFinancialItem = {
  returnQty?: number;
  sellType?: ReturnSellType;
  unitsPerBox?: number;
  costPrice?: number;
};

export function calculateReturnedCost(items: ReturnFinancialItem[] = []) {
  return items.reduce((sum, item) => {
    const quantity = Math.max(0, Number(item.returnQty) || 0);
    const unitsPerBox = Math.max(1, Number(item.unitsPerBox) || 1);
    const costPerBox = Math.max(0, Number(item.costPrice) || 0);
    const returnedUnits = calculateReturnStockUnits(quantity, item.sellType === 'box' ? 'box' : 'unit', unitsPerBox);
    return sum + (costPerBox / unitsPerBox) * returnedUnits;
  }, 0);
}

export function calculateNetSalesProfit(
  grossRevenue: number,
  grossCost: number,
  returns: Array<{ totalRefund?: number; items?: ReturnFinancialItem[] }>,
  expenses = 0,
) {
  const refunds = returns.reduce((sum, entry) => sum + Math.max(0, Number(entry.totalRefund) || 0), 0);
  const returnedCost = returns.reduce((sum, entry) => sum + calculateReturnedCost(entry.items), 0);
  const netRevenue = Number(grossRevenue || 0) - refunds;
  const netCost = Number(grossCost || 0) - returnedCost;
  return {
    refunds,
    returnedCost,
    netRevenue,
    netCost,
    netProfit: netRevenue - netCost - Number(expenses || 0),
  };
}

