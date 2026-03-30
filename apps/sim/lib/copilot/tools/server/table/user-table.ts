import { createLogger } from '@sim/logger'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import type { UserTableArgs, UserTableResult } from '@/lib/copilot/tools/shared/schemas'
import { COLUMN_TYPES } from '@/lib/table/constants'
import {
  addTableColumn,
  batchInsertRows,
  batchUpdateRows,
  createTable,
  deleteColumn,
  deleteColumns,
  deleteRow,
  deleteRowsByFilter,
  deleteRowsByIds,
  deleteTable,
  getRowById,
  getTableById,
  insertRow,
  queryRows,
  renameColumn,
  renameTable,
  updateColumnConstraints,
  updateColumnType,
  updateRow,
  updateRowsByFilter,
} from '@/lib/table/service'
import type { ColumnDefinition, RowData, TableDefinition } from '@/lib/table/types'
import {
  downloadWorkspaceFile,
  resolveWorkspaceFileReference,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('UserTableServerTool')

const MAX_BATCH_SIZE = 1000
const SCHEMA_SAMPLE_SIZE = 100

type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json'

function sanitizeColumnName(raw: string): string {
  let name = raw
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  if (!name || /^\d/.test(name)) name = `col_${name}`
  return name
}

function sanitizeHeaders(
  headers: string[],
  rows: Record<string, unknown>[]
): { headers: string[]; rows: Record<string, unknown>[] } {
  const renamed = new Map<string, string>()
  const seen = new Set<string>()

  for (const raw of headers) {
    let safe = sanitizeColumnName(raw)
    while (seen.has(safe)) safe = `${safe}_`
    seen.add(safe)
    renamed.set(raw, safe)
  }

  const noChange = headers.every((h) => renamed.get(h) === h)
  if (noChange) return { headers, rows }

  return {
    headers: headers.map((h) => renamed.get(h)!),
    rows: rows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const [raw, safe] of renamed) {
        if (raw in row) out[safe] = row[raw]
      }
      return out
    }),
  }
}

async function resolveWorkspaceFile(
  fileReference: string,
  workspaceId: string
): Promise<{ buffer: Buffer; name: string; type: string }> {
  const record = await resolveWorkspaceFileReference(workspaceId, fileReference)
  if (!record) {
    throw new Error(
      `File not found: "${fileReference}". Use glob("files/by-id/*/meta.json") to list canonical file IDs.`
    )
  }
  const buffer = await downloadWorkspaceFile(record)
  return { buffer, name: record.name, type: record.type }
}

function parseFileRows(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'json' || contentType === 'application/json') {
    return parseJsonRows(buffer)
  }
  if (ext === 'csv' || ext === 'tsv' || contentType === 'text/csv') {
    return parseCsvRows(buffer)
  }
  throw new Error(`Unsupported file format: "${ext}". Supported: csv, tsv, json`)
}

async function parseJsonRows(
  buffer: Buffer
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const parsed = JSON.parse(buffer.toString('utf-8'))
  if (!Array.isArray(parsed)) {
    throw new Error('JSON file must contain an array of objects')
  }
  if (parsed.length === 0) {
    throw new Error('JSON file contains an empty array')
  }
  const headerSet = new Set<string>()
  for (const row of parsed) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new Error('Each element in the JSON array must be a plain object')
    }
    for (const key of Object.keys(row)) headerSet.add(key)
  }
  return sanitizeHeaders([...headerSet], parsed)
}

async function parseCsvRows(
  buffer: Buffer
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const { parse } = await import('csv-parse/sync')
  const parsed = parse(buffer.toString('utf-8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_records_with_error: true,
    cast: false,
  }) as Record<string, unknown>[]
  if (parsed.length === 0) {
    throw new Error('CSV file has no data rows')
  }
  const headers = Object.keys(parsed[0])
  if (headers.length === 0) {
    throw new Error('CSV file has no headers')
  }
  return sanitizeHeaders(headers, parsed)
}

function inferColumnType(values: unknown[]): ColumnType {
  const nonEmpty = values.filter((v) => v !== null && v !== undefined && v !== '')
  if (nonEmpty.length === 0) return 'string'

  const allNumber = nonEmpty.every((v) => {
    const n = Number(v)
    return !Number.isNaN(n) && String(v).trim() !== ''
  })
  if (allNumber) return 'number'

  const allBoolean = nonEmpty.every((v) => {
    const s = String(v).toLowerCase()
    return s === 'true' || s === 'false'
  })
  if (allBoolean) return 'boolean'

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/
  const allDate = nonEmpty.every((v) => {
    const s = String(v)
    return isoDatePattern.test(s) && !Number.isNaN(Date.parse(s))
  })
  if (allDate) return 'date'

  return 'string'
}

function inferSchema(headers: string[], rows: Record<string, unknown>[]): ColumnDefinition[] {
  const sample = rows.slice(0, SCHEMA_SAMPLE_SIZE)
  return headers.map((name) => ({
    name,
    type: inferColumnType(sample.map((r) => r[name])),
  }))
}

function coerceValue(value: unknown, colType: ColumnType): string | number | boolean | null {
  if (value === null || value === undefined || value === '') return null
  switch (colType) {
    case 'number': {
      const n = Number(value)
      return Number.isNaN(n) ? null : n
    }
    case 'boolean': {
      const s = String(value).toLowerCase()
      return s === 'true'
    }
    case 'date':
      return new Date(String(value)).toISOString()
    default:
      return String(value)
  }
}

function coerceRows(
  rows: Record<string, unknown>[],
  columns: ColumnDefinition[],
  columnMap: Map<string, ColumnDefinition>
): RowData[] {
  return rows.map((row) => {
    const coerced: RowData = {}
    for (const col of columns) {
      if (row[col.name] !== undefined) {
        coerced[col.name] = coerceValue(row[col.name], col.type as ColumnType)
      }
    }
    return coerced
  })
}

async function batchInsertAll(
  tableId: string,
  rows: RowData[],
  table: TableDefinition,
  workspaceId: string,
  context?: ServerToolContext
): Promise<number> {
  let inserted = 0
  for (let i = 0; i < rows.length; i += MAX_BATCH_SIZE) {
    assertServerToolNotAborted(context, 'Request aborted before table mutation could be applied.')
    const batch = rows.slice(i, i + MAX_BATCH_SIZE)
    const requestId = crypto.randomUUID().slice(0, 8)
    const result = await batchInsertRows({ tableId, rows: batch, workspaceId }, table, requestId)
    inserted += result.length
  }
  return inserted
}

export const userTableServerTool: BaseServerTool<UserTableArgs, UserTableResult> = {
  name: 'user_table',
  async execute(params: UserTableArgs, context?: ServerToolContext): Promise<UserTableResult> {
    const reqLogger = logger.withMetadata({ messageId: context?.messageId })

    if (!context?.userId) {
      logger.error('Unauthorized attempt to access user table - no authenticated user context')
      throw new Error('Authentication required')
    }

    const { operation, args = {} } = params
    const workspaceId =
      context.workspaceId || ((args as Record<string, unknown>).workspaceId as string | undefined)
    const assertNotAborted = () =>
      assertServerToolNotAborted(context, 'Request aborted before table mutation could be applied.')

    try {
      switch (operation) {
        case 'create': {
          if (!args.name) {
            return { success: false, message: 'Name is required for creating a table' }
          }
          if (!args.schema) {
            return { success: false, message: 'Schema is required for creating a table' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          const table = await createTable(
            {
              name: args.name,
              description: args.description,
              schema: args.schema,
              workspaceId,
              userId: context.userId,
            },
            requestId
          )

          return {
            success: true,
            message: `Created table "${table.name}" (${table.id})`,
            data: { table },
          }
        }

        case 'get': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }

          const table = await getTableById(args.tableId)
          if (!table) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }

          return {
            success: true,
            message: `Table "${table.name}" has ${table.rowCount} rows`,
            data: { table },
          }
        }

        case 'get_schema': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }

          const table = await getTableById(args.tableId)
          if (!table) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }

          return {
            success: true,
            message: `Schema for "${table.name}"`,
            data: { name: table.name, columns: table.schema.columns },
          }
        }

        case 'delete': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const table = await getTableById(args.tableId)
          if (!table) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }
          if (table.workspaceId !== workspaceId) {
            return { success: false, message: 'Table not found' }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          await deleteTable(args.tableId, requestId)

          return {
            success: true,
            message: `Deleted table ${args.tableId}`,
          }
        }

        case 'insert_row': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!args.data) {
            return { success: false, message: 'Data is required for inserting a row' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const table = await getTableById(args.tableId)
          if (!table) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          const row = await insertRow(
            { tableId: args.tableId, data: args.data, workspaceId },
            table,
            requestId
          )

          return {
            success: true,
            message: `Inserted row ${row.id}`,
            data: { row },
          }
        }

        case 'batch_insert_rows': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!args.rows || args.rows.length === 0) {
            return { success: false, message: 'Rows array is required and must not be empty' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const table = await getTableById(args.tableId)
          if (!table) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          const rows = await batchInsertRows(
            { tableId: args.tableId, rows: args.rows, workspaceId },
            table,
            requestId
          )

          return {
            success: true,
            message: `Inserted ${rows.length} rows`,
            data: { rows, insertedCount: rows.length },
          }
        }

        case 'get_row': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!args.rowId) {
            return { success: false, message: 'Row ID is required' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const row = await getRowById(args.tableId, args.rowId, workspaceId)
          if (!row) {
            return { success: false, message: `Row not found: ${args.rowId}` }
          }

          return {
            success: true,
            message: `Row ${row.id}`,
            data: { row },
          }
        }

        case 'query_rows': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          const result = await queryRows(
            args.tableId,
            workspaceId,
            {
              filter: args.filter,
              sort: args.sort,
              limit: args.limit,
              offset: args.offset,
            },
            requestId
          )

          return {
            success: true,
            message: `Returned ${result.rows.length} of ${result.totalCount} rows`,
            data: result,
          }
        }

        case 'update_row': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!args.rowId) {
            return { success: false, message: 'Row ID is required' }
          }
          if (!args.data) {
            return { success: false, message: 'Data is required for updating a row' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const table = await getTableById(args.tableId)
          if (!table) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          const updatedRow = await updateRow(
            { tableId: args.tableId, rowId: args.rowId, data: args.data, workspaceId },
            table,
            requestId
          )

          return {
            success: true,
            message: `Updated row ${updatedRow.id}`,
            data: { row: updatedRow },
          }
        }

        case 'delete_row': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!args.rowId) {
            return { success: false, message: 'Row ID is required' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          await deleteRow(args.tableId, args.rowId, workspaceId, requestId)

          return {
            success: true,
            message: `Deleted row ${args.rowId}`,
          }
        }

        case 'update_rows_by_filter': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!args.filter) {
            return { success: false, message: 'Filter is required for bulk update' }
          }
          if (!args.data) {
            return { success: false, message: 'Data is required for bulk update' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const table = await getTableById(args.tableId)
          if (!table) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          const result = await updateRowsByFilter(
            {
              tableId: args.tableId,
              filter: args.filter,
              data: args.data,
              limit: args.limit,
              workspaceId,
            },
            table,
            requestId
          )

          return {
            success: true,
            message: `Updated ${result.affectedCount} rows`,
            data: { affectedCount: result.affectedCount, affectedRowIds: result.affectedRowIds },
          }
        }

        case 'delete_rows_by_filter': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!args.filter) {
            return { success: false, message: 'Filter is required for bulk delete' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          const result = await deleteRowsByFilter(
            {
              tableId: args.tableId,
              filter: args.filter,
              limit: args.limit,
              workspaceId,
            },
            requestId
          )

          return {
            success: true,
            message: `Deleted ${result.affectedCount} rows`,
            data: { affectedCount: result.affectedCount, affectedRowIds: result.affectedRowIds },
          }
        }

        case 'batch_update_rows': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const rawUpdates = (args as Record<string, unknown>).updates as
            | Array<{ rowId: string; data: Record<string, unknown> }>
            | undefined
          const columnName = (args as Record<string, unknown>).columnName as string | undefined
          const valuesMap = (args as Record<string, unknown>).values as
            | Record<string, unknown>
            | undefined

          let updates: Array<{ rowId: string; data: Record<string, unknown> }>

          if (rawUpdates && rawUpdates.length > 0) {
            updates = rawUpdates
          } else if (columnName && valuesMap) {
            updates = Object.entries(valuesMap).map(([rowId, value]) => ({
              rowId,
              data: { [columnName]: value },
            }))
          } else {
            return {
              success: false,
              message: 'Provide either "updates" array or "columnName" + "values" map',
            }
          }

          if (updates.length > MAX_BATCH_SIZE) {
            return {
              success: false,
              message: `Too many updates (${updates.length}). Maximum is ${MAX_BATCH_SIZE}.`,
            }
          }

          const table = await getTableById(args.tableId)
          if (!table) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          const result = await batchUpdateRows(
            {
              tableId: args.tableId,
              updates: updates as Array<{ rowId: string; data: RowData }>,
              workspaceId,
            },
            table,
            requestId
          )

          return {
            success: true,
            message: `Updated ${result.affectedCount} rows`,
            data: { affectedCount: result.affectedCount, affectedRowIds: result.affectedRowIds },
          }
        }

        case 'batch_delete_rows': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const rowIds = (args as Record<string, unknown>).rowIds as string[] | undefined
          if (!rowIds || rowIds.length === 0) {
            return { success: false, message: 'rowIds array is required' }
          }

          if (rowIds.length > MAX_BATCH_SIZE) {
            return {
              success: false,
              message: `Too many row IDs (${rowIds.length}). Maximum is ${MAX_BATCH_SIZE}.`,
            }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          const result = await deleteRowsByIds(
            { tableId: args.tableId, rowIds, workspaceId },
            requestId
          )

          return {
            success: true,
            message: `Deleted ${result.deletedCount} rows`,
            data: {
              deletedCount: result.deletedCount,
              deletedRowIds: result.deletedRowIds,
            },
          }
        }

        case 'create_from_file': {
          const fileId = (args as Record<string, unknown>).fileId as string | undefined
          const filePath = (args as Record<string, unknown>).filePath as string | undefined
          const fileReference = fileId || filePath
          if (!fileReference) {
            return {
              success: false,
              message:
                'fileId is required for create_from_file. Read files/{name}/meta.json or files/by-id/*/meta.json to get the canonical file ID.',
            }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const file = await resolveWorkspaceFile(fileReference, workspaceId)
          const { headers, rows } = await parseFileRows(file.buffer, file.name, file.type)
          if (rows.length === 0) {
            return { success: false, message: 'File contains no data rows' }
          }

          const columns = inferSchema(headers, rows)
          const tableName = args.name || file.name.replace(/\.[^.]+$/, '')
          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          const table = await createTable(
            {
              name: tableName,
              description: args.description || `Imported from ${file.name}`,
              schema: { columns },
              workspaceId,
              userId: context.userId,
            },
            requestId
          )

          const columnMap = new Map(columns.map((c) => [c.name, c]))
          const coerced = coerceRows(rows, columns, columnMap)
          const inserted = await batchInsertAll(table.id, coerced, table, workspaceId, context)

          reqLogger.info('Table created from file', {
            tableId: table.id,
            fileName: file.name,
            columns: columns.length,
            rows: inserted,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Created table "${table.name}" with ${columns.length} columns and ${inserted} rows from "${file.name}"`,
            data: {
              tableId: table.id,
              tableName: table.name,
              columns: columns.map((c) => ({ name: c.name, type: c.type })),
              rowCount: inserted,
              sourceFile: file.name,
            },
          }
        }

        case 'import_file': {
          const fileId = (args as Record<string, unknown>).fileId as string | undefined
          const filePath = (args as Record<string, unknown>).filePath as string | undefined
          const tableId = (args as Record<string, unknown>).tableId as string | undefined
          const fileReference = fileId || filePath
          if (!fileReference) {
            return {
              success: false,
              message:
                'fileId is required for import_file. Read files/{name}/meta.json or files/by-id/*/meta.json to get the canonical file ID.',
            }
          }
          if (!tableId) {
            return { success: false, message: 'tableId is required for import_file' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const table = await getTableById(tableId)
          if (!table) {
            return { success: false, message: `Table not found: ${tableId}` }
          }

          const file = await resolveWorkspaceFile(fileReference, workspaceId)
          const { headers, rows } = await parseFileRows(file.buffer, file.name, file.type)
          if (rows.length === 0) {
            return { success: false, message: 'File contains no data rows' }
          }

          const tableColumns = table.schema.columns as ColumnDefinition[]
          const tableColNames = new Set(tableColumns.map((c) => c.name))
          const mappedHeaders = headers.filter((h) => tableColNames.has(h))
          if (mappedHeaders.length === 0) {
            return {
              success: false,
              message: `No matching columns between file (${headers.join(', ')}) and table (${tableColumns.map((c) => c.name).join(', ')})`,
            }
          }

          const requiredMissing = tableColumns
            .filter((c) => c.required && !headers.includes(c.name))
            .map((c) => c.name)
          if (requiredMissing.length > 0) {
            return {
              success: false,
              message: `File is missing required columns: ${requiredMissing.join(', ')}`,
            }
          }

          const columnMap = new Map(tableColumns.map((c) => [c.name, c]))
          const matchedColumns = tableColumns.filter((c) => headers.includes(c.name))
          const coerced = coerceRows(rows, matchedColumns, columnMap)
          const inserted = await batchInsertAll(table.id, coerced, table, workspaceId, context)

          reqLogger.info('Rows imported from file', {
            tableId: table.id,
            fileName: file.name,
            matchedColumns: mappedHeaders.length,
            rows: inserted,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Imported ${inserted} rows into "${table.name}" from "${file.name}" (${mappedHeaders.length} columns matched)`,
            data: {
              tableId: table.id,
              tableName: table.name,
              matchedColumns: mappedHeaders,
              skippedColumns: headers.filter((h) => !tableColNames.has(h)),
              rowCount: inserted,
              sourceFile: file.name,
            },
          }
        }

        case 'add_column': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          const col = (args as Record<string, unknown>).column as
            | {
                name: string
                type: string
                unique?: boolean
                position?: number
              }
            | undefined
          if (!col?.name || !col?.type) {
            return {
              success: false,
              message: 'column with name and type is required for add_column',
            }
          }
          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          const updated = await addTableColumn(args.tableId, col, requestId)
          return {
            success: true,
            message: `Added column "${col.name}" (${col.type}) to table`,
            data: { schema: updated.schema },
          }
        }

        case 'rename_column': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          const colName = (args as Record<string, unknown>).columnName as string | undefined
          const newColName = (args as Record<string, unknown>).newName as string | undefined
          if (!colName || !newColName) {
            return { success: false, message: 'columnName and newName are required' }
          }
          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          const updated = await renameColumn(
            { tableId: args.tableId, oldName: colName, newName: newColName },
            requestId
          )
          return {
            success: true,
            message: `Renamed column "${colName}" to "${newColName}"`,
            data: { schema: updated.schema },
          }
        }

        case 'delete_column': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          const colName = (args as Record<string, unknown>).columnName as string | undefined
          const colNames = (args as Record<string, unknown>).columnNames as string[] | undefined
          const names = colNames ?? (colName ? [colName] : null)
          if (!names || names.length === 0) {
            return { success: false, message: 'columnName or columnNames is required' }
          }
          const requestId = crypto.randomUUID().slice(0, 8)
          if (names.length === 1) {
            assertNotAborted()
            const updated = await deleteColumn(
              { tableId: args.tableId, columnName: names[0] },
              requestId
            )
            return {
              success: true,
              message: `Deleted column "${names[0]}"`,
              data: { schema: updated.schema },
            }
          }
          assertNotAborted()
          const updated = await deleteColumns(
            { tableId: args.tableId, columnNames: names },
            requestId
          )
          return {
            success: true,
            message: `Deleted ${names.length} columns: ${names.join(', ')}`,
            data: { schema: updated.schema },
          }
        }

        case 'update_column': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          const colName = (args as Record<string, unknown>).columnName as string | undefined
          if (!colName) {
            return { success: false, message: 'columnName is required' }
          }
          const newType = (args as Record<string, unknown>).newType as string | undefined
          const uniqFlag = (args as Record<string, unknown>).unique as boolean | undefined
          if (newType === undefined && uniqFlag === undefined) {
            return {
              success: false,
              message: 'At least one of newType or unique must be provided',
            }
          }
          const requestId = crypto.randomUUID().slice(0, 8)
          let result: TableDefinition | undefined
          if (newType !== undefined) {
            if (!(COLUMN_TYPES as readonly string[]).includes(newType)) {
              return {
                success: false,
                message: `Invalid column type "${newType}". Must be one of: ${COLUMN_TYPES.join(', ')}`,
              }
            }
            assertNotAborted()
            result = await updateColumnType(
              {
                tableId: args.tableId,
                columnName: colName,
                newType: newType as (typeof COLUMN_TYPES)[number],
              },
              requestId
            )
          }
          if (uniqFlag !== undefined) {
            assertNotAborted()
            result = await updateColumnConstraints(
              { tableId: args.tableId, columnName: colName, unique: uniqFlag },
              requestId
            )
          }
          return {
            success: true,
            message: `Updated column "${colName}"`,
            data: { schema: result?.schema },
          }
        }

        case 'rename': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          const newName = (args as Record<string, unknown>).newName as string | undefined
          if (!newName) {
            return { success: false, message: 'newName is required for renaming a table' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const table = await getTableById(args.tableId)
          if (!table) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }
          if (table.workspaceId !== workspaceId) {
            return { success: false, message: 'Table not found' }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          assertNotAborted()
          const renamed = await renameTable(args.tableId, newName, requestId)

          return {
            success: true,
            message: `Renamed table to "${renamed.name}"`,
            data: { table: { id: renamed.id, name: renamed.name } },
          }
        }

        default:
          return { success: false, message: `Unknown operation: ${operation}` }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const cause =
        error instanceof Error && error.cause
          ? error.cause instanceof Error
            ? error.cause.message
            : String(error.cause)
          : undefined
      reqLogger.error('Table operation failed', {
        operation,
        error: errorMessage,
        cause,
      })
      const displayMessage = cause ? `${errorMessage} (${cause})` : errorMessage
      return { success: false, message: `Operation failed: ${displayMessage}` }
    }
  },
}
