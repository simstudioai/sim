import { importDurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import {
  createExactEmptyTableRowSecretProvenance,
  createTableRowSecretProvenanceFromRegistry,
  createUnknownTableRowSecretProvenance,
} from '@/lib/table/rows/secret-provenance'
import type { RowData, TableRowSecretProvenanceWrite } from '@/lib/table/types'
import { getStoredFileSecretProvenanceByKey } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/** Stamps each imported row with the provenance its cells inherit from the source file. */
export type ImportedRowProvenance = (row: RowData) => TableRowSecretProvenanceWrite

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
  return (row) => createTableRowSecretProvenanceFromRegistry(row, registry)
}
