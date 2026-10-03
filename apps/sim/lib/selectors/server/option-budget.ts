import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'

export interface SelectorOptionBudgetAppendResult {
  full: boolean
  overflow: boolean
}

/** Appends only the options that fit in the selector response budget. */
export function appendSelectorOptions<T>(
  target: T[],
  incoming: readonly T[],
  limit = MAX_SELECTOR_OPTIONS
): SelectorOptionBudgetAppendResult {
  const remaining = Math.max(0, limit - target.length)
  const accepted = Math.min(remaining, incoming.length)
  for (let index = 0; index < accepted; index++) {
    target.push(incoming[index])
  }
  return {
    full: target.length >= limit,
    overflow: incoming.length > accepted,
  }
}
