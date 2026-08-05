import type { TablePredicate, TablePredicateInput } from '@/lib/table/types'

/**
 * Converts the readable single-condition v2 input into the grouped shape every
 * downstream table path stores and executes. Callers validate untrusted input
 * before normalization; contract transforms call this only after a strict parse.
 */
export function normalizeTablePredicate(predicate: TablePredicateInput): TablePredicate {
  return 'field' in predicate ? { all: [predicate] } : predicate
}
