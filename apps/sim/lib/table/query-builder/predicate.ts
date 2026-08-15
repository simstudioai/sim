import type { TablePredicate, TablePredicateInput } from '@/lib/table/types'

/** Max members in one `all`/`any` group. */
export const MAX_PREDICATE_GROUP_SIZE = 100

/** Max nesting levels; the root group counts as level 1. */
export const MAX_PREDICATE_DEPTH = 10

/** Max total nodes — groups plus leaves — in one predicate tree. */
export const MAX_PREDICATE_NODES = 500

/**
 * Returns the predicate size-limit violation for an untrusted tree, if any.
 * The walk stays iterative so pathological input cannot overflow the call stack
 * before the caller turns the result into its boundary-specific validation error.
 */
export function getTablePredicateTreeSizeError(root: unknown): string | null {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 1 }]
  let nodes = 0

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!
    if (++nodes > MAX_PREDICATE_NODES) {
      return `Filter has too many conditions (max ${MAX_PREDICATE_NODES})`
    }
    if (depth > MAX_PREDICATE_DEPTH) {
      return `Filter nesting is too deep (max ${MAX_PREDICATE_DEPTH} levels)`
    }
    if (typeof node !== 'object' || node === null) continue

    const group = node as { all?: unknown; any?: unknown }
    const members = Array.isArray(group.all)
      ? group.all
      : Array.isArray(group.any)
        ? group.any
        : null
    if (!members) continue
    if (members.length > MAX_PREDICATE_GROUP_SIZE) {
      return `A filter group can contain at most ${MAX_PREDICATE_GROUP_SIZE} conditions`
    }
    for (const member of members) stack.push({ node: member, depth: depth + 1 })
  }

  return null
}

/**
 * Converts the readable single-condition v2 input into the grouped shape every
 * downstream table path stores and executes. Callers validate untrusted input
 * before normalization; contract transforms call this only after a strict parse.
 */
export function normalizeTablePredicate(predicate: TablePredicateInput): TablePredicate {
  return 'field' in predicate ? { all: [predicate] } : predicate
}
