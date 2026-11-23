/**
 * Runs `fn` over `items` with at most `limit` in flight, each slot taking the next item as soon as
 * it frees (one slow item never holds the others back), and returns the results in `items` order.
 *
 * Failure semantics: after a failure no further item starts, and the first failure is thrown only
 * once the items already running have settled, so nothing the batch started is still running (or
 * writing) when the caller handles the error. Successes are not returned alongside a failure.
 * Pick the mapper to match what a partial result is worth:
 * - a caller whose result is only meaningful complete (an embedding batch, a multi-step write)
 *   lets the mapper throw and handles the one error;
 * - a caller materializing per-row data (a logs page) passes a total mapper that catches and
 *   returns a degraded value, so one bad row cannot fail the page;
 * - a caller that needs every item attempted and each outcome uses
 *   {@link mapSettledWithConcurrency}.
 *
 * `limit` must be a positive integer; anything else is a programming error and throws.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`mapWithConcurrency limit must be a positive integer, got ${limit}`)
  }
  const results = new Array<R>(items.length)
  let next = 0
  let failure: { error: unknown } | undefined
  const slot = async (): Promise<void> => {
    while (!failure && next < items.length) {
      const index = next++
      try {
        results[index] = await fn(items[index], index)
      } catch (error) {
        failure ??= { error }
        return
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, slot))
  if (failure) throw failure.error
  return results
}

/**
 * {@link mapWithConcurrency} with `Promise.allSettled` semantics: every item is attempted, and each
 * result reports its own fulfillment or rejection in input order, so one failure never discards
 * the other items' results or stops the rest from starting.
 */
export function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  return mapWithConcurrency(items, limit, async (item, index) => {
    try {
      return { status: 'fulfilled', value: await fn(item, index) }
    } catch (reason) {
      return { status: 'rejected', reason }
    }
  })
}

/**
 * {@link mapSettledWithConcurrency} for a fan-out of independent side effects (dispatches, events,
 * writes): every item is attempted even after one fails, so a failure never leaves the rest
 * undone, and then the first failure in `items` order is thrown, so the caller still sees it.
 * Returns the results in `items` order when every item succeeds.
 */
export async function mapEachWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const outcomes = await mapSettledWithConcurrency(items, limit, fn)
  const results: R[] = []
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') throw outcome.reason
    results.push(outcome.value)
  }
  return results
}
