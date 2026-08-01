import { TABLE_LIMITS } from '@/lib/table/constants'
import type { TableDefinition } from '@/lib/table/types'

/** Returns whether a table supports persisted mutation and management actions. */
export function canMutateTable(table: Pick<TableDefinition, 'isVirtual'>): boolean {
  return table.isVirtual !== true
}

/** Returns whether a table supports changing its persisted display name. */
export function canRenameTable(table: Pick<TableDefinition, 'isVirtual'>): boolean {
  return canMutateTable(table)
}

/** Returns whether an export can use the persisted-table background job. */
export function shouldUseAsyncTableExport(
  table: Pick<TableDefinition, 'isVirtual' | 'rowCount' | 'jobType' | 'jobStatus'>
): boolean {
  if (table.isVirtual) return false

  const deleteRunning = table.jobType === 'delete' && table.jobStatus === 'running'
  return deleteRunning || table.rowCount > TABLE_LIMITS.EXPORT_ASYNC_THRESHOLD_ROWS
}
