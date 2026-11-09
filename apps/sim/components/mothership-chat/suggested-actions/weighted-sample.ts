import { randomFloat } from '@sim/utils/random'

/**
 * Weighted sampling without replacement. Each pick's probability is
 * proportional to its weight, so the set stays varied while staying relevant.
 * A constant weight yields a uniform sample.
 */
export function weightedSample<T>(
  pool: readonly T[],
  n: number,
  weightOf: (item: T) => number
): T[] {
  const remaining = pool.map((item) => ({ item, weight: Math.max(weightOf(item), 0) }))
  const out: T[] = []
  while (out.length < n && remaining.length > 0) {
    const total = remaining.reduce((sum, entry) => sum + entry.weight, 0)
    if (total <= 0) break
    let roll = randomFloat() * total
    const index = remaining.findIndex((entry) => {
      roll -= entry.weight
      return roll <= 0
    })
    const [picked] = remaining.splice(index === -1 ? remaining.length - 1 : index, 1)
    out.push(picked.item)
  }
  return out
}
