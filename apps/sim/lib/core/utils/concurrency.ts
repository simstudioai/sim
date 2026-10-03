/**
 * Maps over `items` with at most `limit` concurrent invocations of `fn`,
 * preserving input order in the result. Use to bound fan-out (e.g. per-row
 * object-storage reads) so a large batch doesn't issue every request at once.
 *
 * Failure is all-or-nothing: results are awaited via `Promise.all`, so a single
 * rejection fails the whole batch. Pick the mapper to match what a partial
 * result is worth to the caller.
 *
 * Callers that materialize per-row data (logs export/list pages) MUST pass a
 * total mapper — one that catches and returns a degraded value rather than
 * throwing — so one bad row cannot break an entire page. Callers whose result is
 * only meaningful complete (embedding a batch, where a partial vector set is not
 * a usable answer) may let the mapper throw and rely on the batch failing.
 *
 * Neither mode keeps the successes alongside a failure; a caller needing that
 * should add an allSettled-style variant rather than bending this one.
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
