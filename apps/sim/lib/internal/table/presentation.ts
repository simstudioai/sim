import type { TableDefinition, TableRow, TableRowSummary } from '@/lib/table'
import { namedRowMapper } from '@/lib/table/cell-format'
import { normalizeColumn, toTableListItem, toWireTimestamp } from '@/lib/table/wire'

export function presentTableListItem(table: TableDefinition): TableDefinition {
  return toTableListItem(table)
}

export function presentTableDetails(table: TableDefinition, maxRows = table.maxRows) {
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    schema: {
      columns: table.schema.columns.map(normalizeColumn),
      ...(table.schema.workflowGroups ? { workflowGroups: table.schema.workflowGroups } : {}),
    },
    metadata: table.metadata ?? null,
    rowCount: table.rowCount,
    maxRows,
    folderId: table.folderId ?? null,
    locks: table.locks,
    createdAt: toWireTimestamp(table.createdAt),
    updatedAt: toWireTimestamp(table.updatedAt),
    jobStatus: table.jobStatus ?? null,
    jobId: table.jobId ?? null,
    jobType: table.jobType ?? null,
    jobError: table.jobError ?? null,
    jobRowsProcessed: table.jobRowsProcessed ?? 0,
  }
}

export function presentCreatedTable(table: TableDefinition) {
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    schema: { columns: table.schema.columns.map(normalizeColumn) },
    rowCount: table.rowCount,
    maxRows: table.maxRows,
    folderId: table.folderId ?? null,
    locks: table.locks,
    createdAt: toWireTimestamp(table.createdAt),
    updatedAt: toWireTimestamp(table.updatedAt),
  }
}

export function presentNamedTableRow(
  row: Pick<TableRowSummary, 'id' | 'data' | 'position' | 'createdAt' | 'updatedAt'>,
  table: TableDefinition
) {
  return {
    id: row.id,
    data: namedRowMapper(table.schema.columns)(row.data),
    position: row.position,
    createdAt: toWireTimestamp(row.createdAt),
    updatedAt: toWireTimestamp(row.updatedAt),
  }
}

export function presentNamedTableQueryRow(row: TableRow, table: TableDefinition) {
  return {
    id: row.id,
    data: namedRowMapper(table.schema.columns)(row.data),
    executions: row.executions,
    position: row.position,
    orderKey: row.orderKey ?? undefined,
    createdAt: toWireTimestamp(row.createdAt),
    updatedAt: toWireTimestamp(row.updatedAt),
  }
}
