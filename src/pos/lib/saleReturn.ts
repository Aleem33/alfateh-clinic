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

