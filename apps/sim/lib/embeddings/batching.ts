/** Splits items into chunks no larger than a provider's per-request item cap. */
export function splitByItemLimit<T>(items: T[], limit: number): T[][] {
  if (items.length <= limit) return [items]
  const result: T[][] = []
  for (let i = 0; i < items.length; i += limit) {
    result.push(items.slice(i, i + limit))
  }
  return result
}

/** Runs `processor` over `items` with at most `concurrency` in flight, preserving order. */
export async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let currentIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++
      results[index] = await processor(items[index], index)
    }
  })

  await Promise.all(workers)
  return results
}
