const activeOperations = new Set<string>();

export function beginDurableSubmission(collection: string, id: string) { activeOperations.add(`${collection}/${id}`); }
export function endDurableSubmission(collection: string, id: string) { activeOperations.delete(`${collection}/${id}`); }
export function isDurableSubmissionActive(collection: string, id: string) { return activeOperations.has(`${collection}/${id}`); }

/** One rejected entry must never prevent independent entries from reaching the cloud. */
export async function replayDurableRecords<T>(records: T[], options: {
  id: (record: T) => string;
  label: (record: T) => string;
  isActive?: (id: string) => boolean;
  exists: (id: string) => Promise<boolean>;
  replay: (record: T) => Promise<void>;
  remove: (id: string) => Promise<void>;
}) {
  const errors: string[] = [];
  for (const record of records) {
    const id = options.id(record);
    if (options.isActive?.(id)) continue;
    try {
      if (!(await options.exists(id))) {
        if (options.isActive?.(id)) continue;
        await options.replay(record);
        if (!(await options.exists(id))) throw new Error('Cloud confirmation is still pending.');
      }
      await options.remove(id);
    } catch (error) {
      errors.push(`${options.label(record)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length) {
    throw new Error(`${errors.length} entry/entries remain saved locally for retry. ${errors.join(' | ')}`);
  }
}
