import { importDurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import { getColumnId } from '@/lib/table/column-keys'
import {
  createExactEmptyTableRowSecretProvenance,
  createTableRowSecretProvenanceFromRegistry,
  createUnknownTableRowSecretProvenance,
} from '@/lib/table/rows/secret-provenance'
import type { RowData, TableRowSecretProvenanceWrite, TableSchema } from '@/lib/table/types'
import { getStoredFileSecretProvenanceByKey } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/**
 * Stamps each imported row with the provenance its cells inherit from the source file. `source`
 * is the row's text as the file held it, keyed by column id, before coercion rewrote any cell.
 */
export type ImportedRowProvenance = (
  row: RowData,
  source?: RowData
) => TableRowSecretProvenanceWrite

/**
 * The provenance every row of an import inherits from the stored file it reads, resolved by the
 * storage key the import streams, so a job queued before this existed is covered too. A source
 * whose provenance is unknown makes every row unknown: the import still succeeds for every caller,
 * and only reads that classify content (Chat's) refuse those rows. A source holding secrets gives
 * each cell exactly the secrets its own value contains. A key no file names (a direct upload), or
 * a file with no recorded secrets, keeps the exact-empty rows every import has always written.
 */
export async function resolveImportedRowProvenance(source: {
  workspaceId: string
  userId?: string
  fileKey: string
}): Promise<ImportedRowProvenance> {
  const provenance = (
    await getStoredFileSecretProvenanceByKey(source.workspaceId, [source.fileKey])
  ).get(source.fileKey)
  if (!provenance) return createExactEmptyTableRowSecretProvenance
  if (provenance.status === 'unknown') return createUnknownTableRowSecretProvenance
  if (provenance.status === 'unrecorded' || provenance.entries.length === 0) {
    return createExactEmptyTableRowSecretProvenance
  }
  const registry = new ResolvedSecretTraceRegistry(
    [],
    source.userId ? { userId: source.userId, workspaceId: source.workspaceId } : undefined
  )
  if (!(await importDurableSecretProvenance(registry, provenance))) {
    return createUnknownTableRowSecretProvenance
  }
  return (row, source) => {
    /**
     * Coercion can rewrite a secret (a number parsed, a date normalized) into text redaction no
     * longer matches; such a row cannot be vouched for cell by cell, so it is unknown.
     */
    for (const [columnId, raw] of Object.entries(source ?? {})) {
      const stored = row[columnId]
      if (stored === null || stored === undefined || Object.is(stored, raw)) continue
      const rawProvenance = registry.exportCommittedProvenanceForValue(raw)
      if (!rawProvenance.complete || rawProvenance.entries.length > 0) {
        return createUnknownTableRowSecretProvenance()
      }
    }
    return createTableRowSecretProvenanceFromRegistry(row, registry)
  }
}

/**
 * Each parsed row's cells as the file held them, keyed by the column id coercion writes, aligned
 * with what `coerceRowsForTable` returns for the same rows.
 */
export function importedRowSources(
  rows: readonly Record<string, unknown>[],
  schema: TableSchema,
  headerToColumn: ReadonlyMap<string, string>
): RowData[] {
  const columnIdByName = new Map(schema.columns.map((column) => [column.name, getColumnId(column)]))
  return rows.map((row) => {
    const source: RowData = {}
    for (const [header, value] of Object.entries(row)) {
      const columnName = headerToColumn.get(header)
      const columnId = columnName === undefined ? undefined : columnIdByName.get(columnName)
      if (columnId !== undefined) source[columnId] = value as RowData[string]
    }
    return source
  })
}
