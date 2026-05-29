/**
 * Maps over `items` with at most `limit` concurrent invocations of `fn`,
 * preserving input order in the result. Use to bound fan-out (e.g. per-row
 * object-storage reads) so a large batch doesn't issue every request at once.
 *
 * Contract: `fn` MUST NOT reject. Results are awaited via `Promise.all`, so a
 * single rejection fails the entire batch (e.g. one bad row would break a whole
 * logs export/list page). Callers that materialize per-row data pass a total
 * mapper (one that catches and returns a degraded value rather than throwing);
 * keep it that way. If a future caller needs per-item isolation, add an
 * allSettled-style variant rather than letting a throwing mapper through here.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const workerCount = Math.max(1, Math.min(limit, items.length))
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}

/** Default bound for per-row object-storage materialization fan-out. */
export const MATERIALIZE_CONCURRENCY = 20
