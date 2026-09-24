export type StockSyncIssue = {
  id: string;
  type?: string;
  status?: string;
  medicineId?: string;
  stock?: number;
};

export function isOperationalNegativeMedicine(data: Record<string, unknown>) {
  return data.deleted !== true
    && data.archived !== true
    && Number(data.stock) < 0;
}

export function findClearedStockIssueIds(
  issues: StockSyncIssue[],
  negativeMedicineIds: ReadonlySet<string>,
) {
  return issues
    .filter(issue => (
      issue.type === 'stock-negative'
      && issue.status !== 'resolved'
      && Boolean(issue.medicineId)
      && !negativeMedicineIds.has(String(issue.medicineId))
    ))
    .map(issue => issue.id);
}

export function shouldWriteNegativeStockIssue(
  existing: StockSyncIssue | undefined,
  stock: number,
) {
  return !existing || existing.status === 'resolved' || Number(existing.stock) !== stock;
}
