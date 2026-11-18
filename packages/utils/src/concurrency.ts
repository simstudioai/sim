/**
 * Runs `fn` over `items` with at most `limit` in flight, each slot taking the next item as soon as
 * it frees (one slow item never holds the others back), and returns the results in `items` order.
 *
 * After a failure no further item starts, and the first failure is thrown only once the items
 * already running have settled, so nothing is still writing when the caller handles it.
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
  let failed = false
  const slot = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++
      try {
        results[index] = await fn(items[index], index)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, slot)
  )
  for (const outcome of settled) if (outcome.status === 'rejected') throw outcome.reason
  return results
}
