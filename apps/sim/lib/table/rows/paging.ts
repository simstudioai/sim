/**
 * Cuts a fetched page to a byte budget: keeps the longest prefix of rows whose
 * serialized `data` fits within `maxBytes`, always keeping at least one row so
 * pagination makes forward progress even when a single row exceeds the budget.
 */
export function trimRowsToByteBudget<T extends { data: unknown }>(
  rows: T[],
  maxBytes: number
): T[] {
  let total = 0
  let kept = 0
  for (const row of rows) {
    total += Buffer.byteLength(JSON.stringify(row.data))
    if (kept > 0 && total > maxBytes) break
    kept++
  }
  return kept === rows.length ? rows : rows.slice(0, kept)
}
