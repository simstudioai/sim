import { type TableExportRecord, toV2TableExport } from '@/lib/table/orchestration/export-resource'
import {
  type CreateTableImportResult,
  type TableImportResource,
  toV2CreateTableImport,
  toV2TableImport,
} from '@/lib/table/orchestration/import-resource'

export function presentV2CreateTableImport(result: CreateTableImportResult) {
  return { data: toV2CreateTableImport(result) }
}

export function presentV2TableImport(record: TableImportResource) {
  return { data: toV2TableImport(record) }
}

export function presentV2TableExport(record: TableExportRecord, queued = false) {
  return { data: toV2TableExport(record, queued) }
}
