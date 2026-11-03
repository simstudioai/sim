import type { ShareRecord } from '@/lib/api/contracts/public-shares'

/** Each item with its public share state, `null` when it was never shared. */
export function attachShares<T extends { id: string }>(
  items: readonly T[],
  shares: ReadonlyMap<string, ShareRecord>
): (T & { share: ShareRecord | null })[] {
  return items.map((item) => ({ ...item, share: shares.get(item.id) ?? null }))
}
