import { cartItemUnits } from './billingCart';
import { aggregateSaleStockAdjustments, type PendingPosSale } from './offlineSalesOutbox';

type Medicine = { id: string; [key: string]: any };

/** Recovery records an already completed sale; checkout stock validation is separate. */
export function buildSaleRecoveryPlan(record: PendingPosSale, medicines: Medicine[], recoveredAt: string) {
  const items = record.saleData.items;
  if (!Array.isArray(items) || !items.length || record.movements.length !== items.length) {
    throw new Error(`Sale ${record.saleData.receiptNo || record.saleId} needs review: incomplete recovery details.`);
  }
  const states = new Map(medicines.map(medicine => [medicine.id, {
    medicine,
    stock: Number(medicine.stock),
    bonus: Number(medicine.bonusStockUnits || 0),
  }]));
  const expected = aggregateSaleStockAdjustments(items);
  if (expected.length !== record.stockAdjustments.length || expected.some(adjustment => {
    const saved = record.stockAdjustments.find(entry => entry.medicineId === adjustment.medicineId);
    return !saved || saved.units !== adjustment.units;
  })) throw new Error(`Sale ${record.saleData.receiptNo || record.saleId} needs review: stock quantities do not match its items.`);

  const discrepancies: Array<Record<string, any>> = [];
  const movements = items.map((item: any, index: number) => {
    const units = cartItemUnits(item);
    const saved = record.movements[index];
    if (!item.medicineId || !Number.isFinite(units) || units <= 0 || !saved.id
      || saved.data.medicineId !== item.medicineId || Number(saved.data.quantity) !== -units) {
      throw new Error(`Sale ${record.saleData.receiptNo || record.saleId} needs review: invalid stock movement.`);
    }
    const state = states.get(item.medicineId);
    const valid = state && Number.isFinite(state.stock) && Number.isFinite(state.bonus)
      && state.stock >= 0 && state.bonus >= 0 && state.bonus <= state.stock;
    const available = valid ? state.stock : 0;
    const appliedUnits = Math.min(units, available);
    const appliedBonusUnits = valid ? Math.max(0, appliedUnits - (state.stock - state.bonus)) : 0;
    const originalBonusUnits = Math.max(0, Number(item.bonusUnitsSold || 0));
    if (!valid || appliedUnits < units || appliedBonusUnits !== originalBonusUnits) {
      discrepancies.push({
        medicineId: item.medicineId, medicineName: item.name || 'Medicine', batchNo: item.batchNo || '',
        movementId: saved.id, requestedUnits: units, appliedUnits, unappliedUnits: units - appliedUnits,
        requestedBonusUnits: originalBonusUnits, appliedBonusUnits,
        reason: !state ? 'missing-batch' : !valid ? 'invalid-stock' : appliedUnits < units ? 'stock-shortage' : 'bonus-allocation-changed',
        status: 'pending',
      });
    }
    if (valid) {
      state.stock -= appliedUnits;
      state.bonus -= appliedBonusUnits;
    }
    return { id: saved.id, data: {
      ...saved.data,
      // Preserve the original sale movement and cost allocation for audit.
      // Explicit applied fields record the actual inventory change on recovery.
      appliedQuantity: -appliedUnits,
      appliedBonusUnits: -appliedBonusUnits,
      unappliedUnits: units - appliedUnits,
      recoveredAt,
    } };
  });
  const medicineUpdates = [...states.values()].filter(state => (
    Number.isFinite(state.stock) && state.stock >= 0 && state.bonus >= 0 && state.bonus <= state.stock
    && expected.some(adjustment => adjustment.medicineId === state.medicine.id)
  )).map(state => ({ id: state.medicine.id, stock: state.stock, bonusStockUnits: state.bonus }));
  const saleData: Record<string, any> = { ...record.saleData, offlineRecoveredAt: recoveredAt, stockReconciliation: discrepancies };
  return {
    // Never reprice, redetermine COGS, or redetermine the business day at upload time.
    saleData,
    medicineUpdates, movements, discrepancies,
  };
}

export async function recoverSaleTransaction(
  transaction: { get: (reference: any) => Promise<any>; set: (reference: any, data: any) => any; update: (reference: any, data: any) => any },
  record: PendingPosSale,
  reference: (collection: string, id: string) => any,
  increment: (amount: number) => any,
  recoveredAt: string,
) {
  const saleRef = reference('sales', record.saleId);
  // The original checkout also reads this same ID before writing, so a timed
  // out transaction and recovery cannot both apply stock or customer credit.
  if ((await transaction.get(saleRef)).exists()) return;
  const snapshots = await Promise.all(record.stockAdjustments.map(adjustment => (
    transaction.get(reference('medicines', adjustment.medicineId))
  )));
  const medicines = snapshots.flatMap((snapshot, index) => snapshot.exists()
    ? [{ ...snapshot.data(), id: record.stockAdjustments[index].medicineId }] : []);
  const plan = buildSaleRecoveryPlan(record, medicines, recoveredAt);
  transaction.set(saleRef, plan.saleData);
  plan.movements.forEach(movement => transaction.set(reference('stockMovements', movement.id), movement.data));
  plan.medicineUpdates.forEach(({ id, ...data }) => transaction.update(reference('medicines', id), data));
  plan.discrepancies.forEach(discrepancy => {
    transaction.set(reference('syncIssues', `sale-stock-${record.saleId}-${discrepancy.movementId}`), {
      ...discrepancy, type: 'sale-stock-reconciliation', status: 'open', saleId: record.saleId,
      receiptNo: record.saleData.receiptNo || record.saleId,
      devicePrefix: String(record.saleData.receiptNo || '').split('-')[1] || '',
      message: `Completed sale ${record.saleData.receiptNo || record.saleId} was uploaded. ${discrepancy.unappliedUnits > 0
        ? `${discrepancy.unappliedUnits} unit(s) could not be deducted.` : 'The paid/bonus stock allocation changed.'} Verify this batch's physical stock and bonus units.`,
      createdAt: recoveredAt, updatedAt: recoveredAt,
    });
  });
  if (record.customerAdjustment && record.customerAdjustment.pendingAmount > 0) {
    transaction.update(reference('customers', record.customerAdjustment.customerId), {
      creditBalance: increment(record.customerAdjustment.pendingAmount),
    });
  }
}
