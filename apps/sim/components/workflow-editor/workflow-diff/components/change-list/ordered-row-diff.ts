import { diffArrays } from 'diff'

const MAX_ROW_EDITS = 128

export interface OrderedDiffRow<T> {
  kind: 'added' | 'removed' | 'context'
  value: T
}

/**
 * Compares exact, unmasked row keys in order. Duplicate keys remain separate occurrences.
 * Large rewrites use complete before/after rows once the bounded edit search is exhausted.
 */
export function diffOrderedRows<T extends { key: string }>(
  before: T[],
  after: T[]
): OrderedDiffRow<T>[] {
  const parts = diffArrays(before, after, {
    comparator: (left, right) => left.key === right.key,
    maxEditLength: MAX_ROW_EDITS,
  })
  if (!parts) {
    return [
      ...before.map((value) => ({ kind: 'removed' as const, value })),
      ...after.map((value) => ({ kind: 'added' as const, value })),
    ]
  }
  return parts.flatMap((part) => {
    const kind = part.added ? 'added' : part.removed ? 'removed' : 'context'
    return part.value.map((value) => ({ kind, value }))
  })
}
