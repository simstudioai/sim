import {
  type BatchExecutionResult,
  type BatchTerminalFailure,
  requireBoundedResourceSelection,
  rethrowBatchTerminalFailure,
} from '@/lib/core/application/batch-policy'
import { MAX_TABLE_BATCH_ITEMS } from '@/lib/table/constants'

/**
 * Bulk table operations authorize each item and report a per-item outcome,
 * matching the knowledge domain's `sequential_best_effort` bulk policy. Moves
 * remain individual mutations. Deletes validate the explicit selection as a
 * group, then use per-table savepoints so recoverable statement failures retain
 * a dependency-safe prefix. An outer transaction failure rolls that phase back.
 */
export const BULK_MOVE_TABLES_COST_POLICY = {
  maxItems: MAX_TABLE_BATCH_ITEMS,
  execution: 'sequential_best_effort',
} as const

export const BULK_DELETE_TABLES_COST_POLICY = {
  maxItems: MAX_TABLE_BATCH_ITEMS,
  execution: 'sequential_best_effort',
} as const

/** Domain names for the shared batch shapes, so call sites read in table terms. */
export type TableBatchTerminalFailure = BatchTerminalFailure
export type TableBatchExecutionResult = BatchExecutionResult

/**
 * Re-throws the failure that ended a batch early. Called after audit has been
 * projected, so the items that did commit are still recorded.
 */
export const rethrowTableBatchTerminalFailure: (result: TableBatchExecutionResult) => void =
  rethrowBatchTerminalFailure

export interface BoundedTableSelection {
  tableIds: string[]
  folderIds: string[]
}

/**
 * Deduplicates and bounds a mixed table/folder selection before any protected
 * row is loaded. The cap is on the combined count — see
 * {@link requireBoundedResourceSelection}.
 */
export function requireBoundedTableSelection(
  tableIds: readonly string[],
  folderIds: readonly string[],
  maxItems: number
): BoundedTableSelection {
  const selection = requireBoundedResourceSelection(tableIds, folderIds, maxItems, {
    singular: 'table',
    plural: 'tables',
  })
  return { tableIds: selection.resourceIds, folderIds: selection.folderIds }
}
