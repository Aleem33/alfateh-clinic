export type StockSyncIssue = {
  id: string;
  type?: string;
  status?: string;
  medicineId?: string;
  stock?: number;
};

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
