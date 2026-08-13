import { buildNameById, remapGroupColumnRefs } from '@/lib/table/column-keys'
import { type TableExportRecord, toV2TableExport } from '@/lib/table/orchestration/export-resource'
import {
  type CreateTableImportResult,
  type TableImportResource,
  toV2CreateTableImport,
  toV2TableImport,
} from '@/lib/table/orchestration/import-resource'
import type { TableSchema, WorkflowGroup } from '@/lib/table/types'

export function presentV2CreateTableImport(result: CreateTableImportResult) {
  return { data: toV2CreateTableImport(result) }
}

export function presentV2TableImport(record: TableImportResource) {
  return { data: toV2TableImport(record) }
}

export function presentV2TableExport(record: TableExportRecord, queued = false) {
  return { data: toV2TableExport(record, queued) }
}

/**
 * A workflow group with its column references presented as column **names**.
 *
 * Groups store `outputs[].columnName`, `dependencies.columns[]`, and
 * `inputMappings[].columnName` as stable column **ids** so a rename cannot
 * orphan them — but the field is named for, documented as, and accepted on
 * create as a name, and every other v2 row surface is keyed by name. Reading
 * back a `col_…` id under `columnName` meant a group could not be round-tripped
 * into a create, and the value did not correspond to anything else the caller
 * could see. `remapGroupColumnRefs` is the same rewrite the write path uses,
 * driven by the inverse map; a ref naming no current column is left as-is, so a
 * legacy name-keyed group and a ref to a since-deleted column both survive.
 */
export function presentV2WorkflowGroup(group: WorkflowGroup, schema: TableSchema): WorkflowGroup {
  return remapGroupColumnRefs(group, buildNameById(schema))
}
