import { importDurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import { getColumnId } from '@/lib/table/column-keys'
import {
  createExactEmptyTableRowSecretProvenance,
  createTableRowSecretProvenanceFromRegistry,
  createUnknownTableRowSecretProvenance,
} from '@/lib/table/rows/secret-provenance'
import type { RowData, TableRowSecretProvenanceWrite, TableSchema } from '@/lib/table/types'
import { getStoredFileSecretProvenanceByKey } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { isNonIdentifyingSecretLiteral } from '@/executor/utils/resolved-secret-match-policy'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/**
 * Stamps each imported row with the provenance its cells inherit from the source file. `source`
 * holds parsed CSV cells, keyed by column id, before column coercion rewrote any value.
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
  const snapshot = registry.getModelEgressSnapshot()
  if (!snapshot.complete) return createUnknownTableRowSecretProvenance
  const trimmedCandidates = snapshot.matches.flatMap(({ plaintext }) => {
    const start = plaintext.trimStart()
    const end = plaintext.trimEnd()
    const whole = plaintext.trim()
    const candidate = {
      plaintext,
      start: start !== plaintext && !isNonIdentifyingSecretLiteral(start) ? start : undefined,
      end: end !== plaintext && !isNonIdentifyingSecretLiteral(end) ? end : undefined,
      whole:
        start !== plaintext && end !== plaintext && !isNonIdentifyingSecretLiteral(whole)
          ? whole
          : undefined,
    }
    return candidate.start || candidate.end || candidate.whole ? [candidate] : []
  })
  return (row, source) => {
    /**
     * Coercion can rewrite a secret (a number parsed, a date normalized) into text redaction no
     * longer matches; such a row cannot be vouched for cell by cell, so it is unknown.
     */
    for (const [columnId, raw] of Object.entries(source ?? {})) {
      const stored = row[columnId]
      if (stored === null || stored === undefined) continue
      /** CSV trims unquoted field edges before coercion sees them; source candidates stay exact. */
      if (
        typeof raw === 'string' &&
        trimmedCandidates.some(
          ({ plaintext, start, end, whole }) =>
            !raw.includes(plaintext) &&
            ((start !== undefined && raw.startsWith(start)) ||
              (end !== undefined && raw.endsWith(end)) ||
              (whole !== undefined && raw === whole))
        )
      ) {
        return createUnknownTableRowSecretProvenance()
      }
      if (Object.is(stored, raw)) continue
      const rawProvenance = registry.exportCommittedProvenanceForValue(raw)
      if (!rawProvenance.complete || rawProvenance.entries.length > 0) {
        return createUnknownTableRowSecretProvenance()
      }
    }
    return createTableRowSecretProvenanceFromRegistry(row, registry)
  }
}

/**
 * Parsed cells before column coercion, keyed by the column id it writes and aligned with
 * what `coerceRowsForTable` returns for the same rows.
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
