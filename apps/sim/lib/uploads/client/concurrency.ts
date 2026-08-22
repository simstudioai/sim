export const WHOLE_FILE_PARALLEL_UPLOADS = 3

/**
 * Runs a worker with bounded concurrency and preserves input ordering in the settled results.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('Concurrency limit must be a positive safe integer')
  }

  const results: Array<PromiseSettledResult<R>> = Array(items.length)
  if (items.length === 0) return results

  const concurrency = Math.min(limit, items.length)
  let nextIndex = 0

  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const currentIndex = nextIndex++
      if (currentIndex >= items.length) return
      try {
        results[currentIndex] = {
          status: 'fulfilled',
          value: await worker(items[currentIndex], currentIndex),
        }
      } catch (error) {
        results[currentIndex] = { status: 'rejected', reason: error }
      }
    }
  })

  await Promise.all(runners)
  return results
}
