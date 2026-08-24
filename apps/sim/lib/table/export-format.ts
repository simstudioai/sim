/**
 * Shared serialization for table exports — used by both the synchronous streaming export route
 * (small tables) and the background export job worker (large tables), so the two paths produce
 * byte-identical files.
 */

import { formatCsvValue, neutralizeCsvFormula } from '@/lib/core/utils/csv'
import { columnTypeOf } from '@/lib/table/column-types'
import { selectValueToNames } from '@/lib/table/select-values'
import type { ColumnDefinition } from '@/lib/table/types'

/**
 * @deprecated Use `selectValueToNames` from `@/lib/table/select-values`. Kept as
 * an alias so existing export callers/tests don't churn.
 */
export const resolveSelectExportValue = selectValueToNames

export function sanitizeExportFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'table'
}

/**
 * Serializes one cell for CSV, resolving `select` option ids to their names
 * (comma-joined for multi) so the file shows the enum label, not the id.
 */
export function formatCsvCell(column: ColumnDefinition, value: unknown): string {
  // Every other type writes its stored value verbatim so the file re-imports
  // byte-identically.
  if (columnTypeOf(column).storesOpaqueIds) {
    return neutralizeCsvFormula(columnTypeOf(column).formatForDisplay(value, column))
  }
  return formatCsvValue(value)
}
