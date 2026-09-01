import type { SortDirection } from '@/lib/url-state'

/**
 * One row of a foldered list, decorated with everything the comparator needs so the sort
 * itself stays O(N log N) on precomputed values rather than re-deriving keys per comparison.
 */
export interface SortableResource<T> {
  /** The payload handed back in sorted order. */
  item: T
  /** Pinned rows float to the top of every column and direction. */
  pinned: boolean
  /** Display name — the final, direction-independent tiebreaker. */
  name: string
  /**
   * Value for the active sort column, or `null` when the column does not apply to this row
   * (a folder has no row count, token count, or connector list). Null keys sort last in both
   * directions, the same "nulls last" rule the log list applies server-side.
   */
  key: string | number | null
}

/**
 * Orders folders and the resources they contain as ONE list.
 *
 * Folders are not hoisted above their siblings: a folder outranking every file meant a pinned
 * file could never reach the top of the list, since pinning only reordered within each
 * partition. Precedence is pinned → sort key → name, so pinning is the only thing that jumps
 * a row, and it does so regardless of which column is sorted or which way.
 *
 * Neither the pinned bit nor the name tiebreaker is inverted by `desc` — pinning is a
 * user-declared priority rather than another sort key, and a stable A→Z tiebreak keeps rows
 * that tie on the active column (equal timestamps, a whole column of `null` folder keys) in
 * one predictable order instead of the arbitrary one their source arrays happened to have.
 */
export function sortResources<T>(
  entries: SortableResource<T>[],
  direction: SortDirection
): SortableResource<T>[] {
  return entries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1

    if (a.key === null || b.key === null) {
      if (a.key !== b.key) return a.key === null ? 1 : -1
    } else {
      const cmp =
        typeof a.key === 'number' && typeof b.key === 'number'
          ? a.key - b.key
          : String(a.key).localeCompare(String(b.key))
      if (cmp !== 0) return direction === 'asc' ? cmp : -cmp
    }

    return a.name.localeCompare(b.name)
  })
}
