import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { UserTable } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  buildAutoMapping,
  COLUMN_TYPES,
  CSV_MAX_BATCH_SIZE,
  type CsvHeaderMapping,
  CsvImportValidationError,
  coerceRowsForTable,
  inferSchemaFromCsv,
  parseCsvBuffer,
  sanitizeName,
  validateMapping,
} from '@/lib/table'
import { columnTypeForLeaf, deriveOutputColumnName } from '@/lib/table/column-naming'
import {
  addTableColumn,
  addWorkflowGroup,
  addWorkflowGroupOutput,
  batchInsertRows,
  batchUpdateRows,
  createTable,
  deleteColumn,
  deleteColumns,
  deleteRow,
  deleteRowsByFilter,
  deleteRowsByIds,
  deleteTable,
  deleteWorkflowGroup,
  deleteWorkflowGroupOutput,
  getRowById,
  getTableById,
  insertRow,
  queryRows,
  renameColumn,
  renameTable,
  replaceTableRows,
  updateColumnConstraints,
  updateColumnType,
  updateRow,
  updateRowsByFilter,
  updateWorkflowGroup,
} from '@/lib/table/service'
import type {
  ColumnDefinition,
  RowData,
  TableDefinition,
  WorkflowGroup,
  WorkflowGroupDependencies,
  WorkflowGroupOutput,
} from '@/lib/table/types'
import { cancelWorkflowGroupRuns, triggerWorkflowGroupRun } from '@/lib/table/workflow-columns'
import {
  fetchWorkspaceFileBuffer,
  resolveWorkspaceFileReference,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  type FlattenedBlockOutput,
  flattenWorkflowOutputs,
} from '@/lib/workflows/blocks/flatten-outputs'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

const logger = createLogger('UserTableServerTool')

type UserTableArgs = {
  operation: string
  args?: Record<string, any>
}

type UserTableResult = {
  success: boolean
  message: string
  data?: any
}

const MAX_BATCH_SIZE = CSV_MAX_BATCH_SIZE

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
  const buffer = await fetchWorkspaceFileBuffer(record)
  return { buffer, name: record.name, type: record.type }
}

/**
 * Sanitizes raw JSON headers/rows so they conform to the same rules as CSV
 * imports (so `inferSchemaFromCsv` and friends can be reused).
 */
function sanitizeJsonHeaders(
  headers: string[],
  rows: Record<string, unknown>[]
): { headers: string[]; rows: Record<string, unknown>[] } {
  const renamed = new Map<string, string>()
  const seen = new Set<string>()

  for (const raw of headers) {
    let safe = sanitizeName(raw)
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

/**
 * Loads the live workflow state and flattens it into pickable outputs. Used
 * to validate `(blockId, path)` pairs the AI passes to add/update_workflow_group
 * before they get stored as stale references — and to power `list_workflow_outputs`
 * so the AI can discover valid picks instead of guessing.
 */
async function loadFlattenedWorkflowOutputs(
  workflowId: string
): Promise<FlattenedBlockOutput[] | null> {
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized) return null
  const blocks = Object.values(normalized.blocks ?? {}).map((b) => ({
    id: b.id,
    type: b.type,
    name: b.name,
    triggerMode: (b as { triggerMode?: boolean }).triggerMode,
    subBlocks: b.subBlocks as Record<string, unknown> | undefined,
  }))
  return flattenWorkflowOutputs(blocks, normalized.edges ?? [])
}

/**
 * Validates a list of `(blockId, path)` outputs against the live workflow.
 * Returns `null` on success; on failure returns an error message that lists
 * the valid options so the AI can retry without guessing again.
 */
function validateOutputsAgainstWorkflow(
  outputs: Array<{ blockId: string; path: string }>,
  flattened: FlattenedBlockOutput[],
  workflowId: string
): string | null {
  const valid = new Set(flattened.map((f) => `${f.blockId}::${f.path}`))
  const invalid = outputs.filter((o) => !valid.has(`${o.blockId}::${o.path}`))
  if (invalid.length === 0) return null
  const sample = flattened
    .slice(0, 12)
    .map((f) => `  - ${f.blockId} (${f.blockName}) → ${f.path}`)
    .join('\n')
  const invalidList = invalid.map((o) => `  - ${o.blockId} → ${o.path}`).join('\n')
  return `Invalid output(s) for workflow ${workflowId}:\n${invalidList}\n\nValid options${flattened.length > 12 ? ' (first 12)' : ''}:\n${sample}\n\nCall list_workflow_outputs with workflowId="${workflowId}" to see all valid (blockId, path) picks.`
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
  return sanitizeJsonHeaders([...headerSet], parsed)
}

async function parseFileRows(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'json' || contentType === 'application/json') {
    return parseJsonRows(buffer)
  }
  if (ext === 'csv' || ext === 'tsv' || contentType === 'text/csv') {
    const delimiter = ext === 'tsv' ? '\t' : ','
    return parseCsvBuffer(buffer, delimiter)
  }
  throw new Error(`Unsupported file format: "${ext}". Supported: csv, tsv, json`)
}

async function batchInsertAll(
  tableId: string,
  rows: RowData[],
  table: TableDefinition,
  workspaceId: string,
  context?: ServerToolContext
): Promise<number> {
  let inserted = 0
  const userId = context?.userId
  for (let i = 0; i < rows.length; i += MAX_BATCH_SIZE) {
    assertServerToolNotAborted(context, 'Request aborted before table mutation could be applied.')
    const batch = rows.slice(i, i + MAX_BATCH_SIZE)
    const requestId = generateId().slice(0, 8)
    const result = await batchInsertRows(
      { tableId, rows: batch, workspaceId, userId },
      table,
      requestId
    )
    inserted += result.length
  }
  return inserted
}

export const userTableServerTool: BaseServerTool<UserTableArgs, UserTableResult> = {
  name: UserTable.id,
  async execute(params: UserTableArgs, context?: ServerToolContext): Promise<UserTableResult> {
    const withMessageId = (message: string) =>
      context?.messageId ? `${message} [messageId:${context.messageId}]` : message

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

          const requestId = generateId().slice(0, 8)
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
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const table = await getTableById(args.tableId)
          if (!table || table.workspaceId !== workspaceId) {
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
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const table = await getTableById(args.tableId)
          if (!table || table.workspaceId !== workspaceId) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }

          return {
            success: true,
            message: `Schema for "${table.name}"`,
            data: {
              name: table.name,
              columns: table.schema.columns,
              workflowGroups: table.schema.workflowGroups ?? [],
            },
          }
        }

        case 'delete': {
          const tableIds: string[] = args.tableIds ?? (args.tableId ? [args.tableId] : [])
          if (tableIds.length === 0) {
            return { success: false, message: 'tableId or tableIds is required' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          const deleted: string[] = []
          const failed: string[] = []

          for (const tableId of tableIds) {
            const table = await getTableById(tableId)
            if (!table || table.workspaceId !== workspaceId) {
              failed.push(tableId)
              continue
            }

            const requestId = generateId().slice(0, 8)
            assertNotAborted()
            await deleteTable(tableId, requestId)
            deleted.push(tableId)
          }

          return {
            success: deleted.length > 0,
            message: `Deleted ${deleted.length} table(s)${failed.length > 0 ? `, ${failed.length} not found` : ''}`,
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

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const row = await insertRow(
            {
              tableId: args.tableId,
              data: args.data,
              workspaceId,
              userId: context.userId,
              position: args.position as number | undefined,
            },
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

          const positions = args.positions as number[] | undefined
          if (positions !== undefined && positions.length !== args.rows.length) {
            return {
              success: false,
              message: `positions length (${positions.length}) must match rows length (${args.rows.length})`,
            }
          }
          if (positions !== undefined && new Set(positions).size !== positions.length) {
            return {
              success: false,
              message: 'positions must not contain duplicate values',
            }
          }

          const table = await getTableById(args.tableId)
          if (!table) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const rows = await batchInsertRows(
            {
              tableId: args.tableId,
              rows: args.rows,
              workspaceId,
              userId: context.userId,
              positions,
            },
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

          const requestId = generateId().slice(0, 8)
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

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const updatedRow = await updateRow(
            { tableId: args.tableId, rowId: args.rowId, data: args.data, workspaceId },
            table,
            requestId
          )
          if (!updatedRow) {
            // Only the cell-task path passes a `cancellationGuard`; this caller
            // doesn't, so the guard never trips here. Defensive narrowing.
            return { success: false, message: 'Row update was skipped' }
          }

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

          const requestId = generateId().slice(0, 8)
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

          const requestId = generateId().slice(0, 8)
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

          const requestId = generateId().slice(0, 8)
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

          const requestId = generateId().slice(0, 8)
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

          const requestId = generateId().slice(0, 8)
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

          const { columns, headerToColumn } = inferSchemaFromCsv(headers, rows)
          const tableName = args.name || file.name.replace(/\.[^.]+$/, '')
          const requestId = generateId().slice(0, 8)
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

          const coerced = coerceRowsForTable(rows, { columns }, headerToColumn)
          const inserted = await batchInsertAll(table.id, coerced, table, workspaceId, context)

          logger.info('Table created from file', {
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
          const rawMode = (args as Record<string, unknown>).mode as string | undefined
          const rawMapping = (args as Record<string, unknown>).mapping as
            | CsvHeaderMapping
            | undefined
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
          if (rawMode && rawMode !== 'append' && rawMode !== 'replace') {
            return {
              success: false,
              message: `Invalid mode "${rawMode}". Must be "append" or "replace".`,
            }
          }
          const mode: 'append' | 'replace' = rawMode === 'replace' ? 'replace' : 'append'

          const table = await getTableById(tableId)
          if (!table || table.workspaceId !== workspaceId) {
            return { success: false, message: `Table not found: ${tableId}` }
          }
          if (table.archivedAt) {
            return { success: false, message: `Table is archived: ${tableId}` }
          }

          const file = await resolveWorkspaceFile(fileReference, workspaceId)
          const { headers, rows } = await parseFileRows(file.buffer, file.name, file.type)
          if (rows.length === 0) {
            return { success: false, message: 'File contains no data rows' }
          }

          const mapping: CsvHeaderMapping = rawMapping ?? buildAutoMapping(headers, table.schema)

          let validation: ReturnType<typeof validateMapping>
          try {
            validation = validateMapping({
              csvHeaders: headers,
              mapping,
              tableSchema: table.schema,
            })
          } catch (err) {
            if (err instanceof CsvImportValidationError) {
              return { success: false, message: err.message }
            }
            throw err
          }

          if (validation.mappedHeaders.length === 0) {
            return {
              success: false,
              message: `No matching columns between file (${headers.join(', ')}) and table (${table.schema.columns.map((c) => c.name).join(', ')})`,
            }
          }

          const coerced = coerceRowsForTable(rows, table.schema, validation.effectiveMap)

          if (mode === 'replace') {
            assertNotAborted()
            const requestId = generateId().slice(0, 8)
            const result = await replaceTableRows(
              { tableId: table.id, rows: coerced, workspaceId, userId: context.userId },
              table,
              requestId
            )

            logger.info('Rows replaced from file', {
              tableId: table.id,
              fileName: file.name,
              mode,
              matchedColumns: validation.mappedHeaders.length,
              deleted: result.deletedCount,
              inserted: result.insertedCount,
              userId: context.userId,
            })

            return {
              success: true,
              message: `Replaced rows in "${table.name}" from "${file.name}": deleted ${result.deletedCount}, inserted ${result.insertedCount}`,
              data: {
                tableId: table.id,
                tableName: table.name,
                mode,
                matchedColumns: validation.mappedHeaders,
                skippedColumns: validation.skippedHeaders,
                deletedCount: result.deletedCount,
                insertedCount: result.insertedCount,
                sourceFile: file.name,
              },
            }
          }

          const inserted = await batchInsertAll(table.id, coerced, table, workspaceId, context)

          logger.info('Rows imported from file', {
            tableId: table.id,
            fileName: file.name,
            mode,
            matchedColumns: validation.mappedHeaders.length,
            rows: inserted,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Imported ${inserted} rows into "${table.name}" from "${file.name}" (${validation.mappedHeaders.length} columns matched)`,
            data: {
              tableId: table.id,
              tableName: table.name,
              mode,
              matchedColumns: validation.mappedHeaders,
              skippedColumns: validation.skippedHeaders,
              rowCount: inserted,
              sourceFile: file.name,
            },
          }
        }

        case 'add_column': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
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
          const tableForAdd = await getTableById(args.tableId)
          if (!tableForAdd || tableForAdd.workspaceId !== workspaceId) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }
          const requestId = generateId().slice(0, 8)
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
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }
          const colName = (args as Record<string, unknown>).columnName as string | undefined
          const newColName = (args as Record<string, unknown>).newName as string | undefined
          if (!colName || !newColName) {
            return { success: false, message: 'columnName and newName are required' }
          }
          const tableForRename = await getTableById(args.tableId)
          if (!tableForRename || tableForRename.workspaceId !== workspaceId) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }
          const requestId = generateId().slice(0, 8)
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
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }
          const colName = (args as Record<string, unknown>).columnName as string | undefined
          const colNames = (args as Record<string, unknown>).columnNames as string[] | undefined
          const names = colNames ?? (colName ? [colName] : null)
          if (!names || names.length === 0) {
            return { success: false, message: 'columnName or columnNames is required' }
          }
          const tableForDelete = await getTableById(args.tableId)
          if (!tableForDelete || tableForDelete.workspaceId !== workspaceId) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }
          const requestId = generateId().slice(0, 8)
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
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
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
          const tableForUpdate = await getTableById(args.tableId)
          if (!tableForUpdate || tableForUpdate.workspaceId !== workspaceId) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }
          const requestId = generateId().slice(0, 8)
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

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const renamed = await renameTable(args.tableId, newName, requestId)

          return {
            success: true,
            message: `Renamed table to "${renamed.name}"`,
            data: { table: { id: renamed.id, name: renamed.name } },
          }
        }

        case 'list_workflow_outputs': {
          if (!workspaceId) return { success: false, message: 'Workspace ID is required' }
          const workflowId = args.workflowId as string | undefined
          if (!workflowId) {
            return {
              success: false,
              message: 'workflowId is required for list_workflow_outputs',
            }
          }
          const flattened = await loadFlattenedWorkflowOutputs(workflowId)
          if (!flattened) {
            return {
              success: false,
              message: `Workflow not found or has no blocks: ${workflowId}`,
            }
          }
          return {
            success: true,
            message: `Found ${flattened.length} output path(s) across the workflow's blocks`,
            data: { workflowId, outputs: flattened },
          }
        }

        case 'add_workflow_group': {
          if (!args.tableId) return { success: false, message: 'Table ID is required' }
          if (!workspaceId) return { success: false, message: 'Workspace ID is required' }
          const workflowId = args.workflowId as string | undefined
          if (!workflowId) {
            return { success: false, message: 'workflowId is required for add_workflow_group' }
          }
          const rawOutputs = args.outputs as
            | Array<{
                blockId: string
                path: string
                columnName?: string
                columnType?: string
              }>
            | undefined
          if (!rawOutputs || rawOutputs.length === 0) {
            return {
              success: false,
              message: 'outputs array (with blockId + path entries) is required',
            }
          }
          const tableForGroup = await getTableById(args.tableId)
          if (!tableForGroup || tableForGroup.workspaceId !== workspaceId) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }

          for (const o of rawOutputs) {
            if (!o.blockId || !o.path) {
              return {
                success: false,
                message: 'Each output entry must include both blockId and path',
              }
            }
          }

          const flattened = await loadFlattenedWorkflowOutputs(workflowId)
          if (!flattened) {
            return {
              success: false,
              message: `Workflow not found or has no blocks: ${workflowId}`,
            }
          }
          const validationError = validateOutputsAgainstWorkflow(
            rawOutputs.map((o) => ({ blockId: o.blockId, path: o.path })),
            flattened,
            workflowId
          )
          if (validationError) {
            return { success: false, message: validationError }
          }
          const leafTypeByKey = new Map(
            flattened.map((f) => [`${f.blockId}::${f.path}`, f.leafType])
          )

          const taken = new Set(tableForGroup.schema.columns.map((c) => c.name))
          const groupId = generateId()
          const outputs: WorkflowGroupOutput[] = []
          const outputColumns: ColumnDefinition[] = []
          for (const o of rawOutputs) {
            const colName = o.columnName ?? deriveOutputColumnName(o.path, taken)
            taken.add(colName)
            outputs.push({ blockId: o.blockId, path: o.path, columnName: colName })
            const leafType = o.columnType ?? leafTypeByKey.get(`${o.blockId}::${o.path}`)
            outputColumns.push({
              name: colName,
              type: columnTypeForLeaf(leafType),
              required: false,
              unique: false,
              workflowGroupId: groupId,
            })
          }
          const dependencies = args.dependencies as WorkflowGroupDependencies | undefined
          const name = args.name as string | undefined
          const group: WorkflowGroup = {
            id: groupId,
            workflowId,
            ...(name ? { name } : {}),
            ...(dependencies ? { dependencies } : {}),
            outputs,
          }
          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          // Mothership stages groups silently by default — the AI may add more
          // columns or update deps before the user wants rows to fire. Caller
          // can opt in by passing `autoRun: true`.
          const autoRun = args.autoRun === true
          const updated = await addWorkflowGroup(
            { tableId: args.tableId, group, outputColumns, autoRun },
            requestId
          )
          return {
            success: true,
            message: `Added workflow group "${name ?? groupId}" with ${outputs.length} output column(s)`,
            data: {
              groupId,
              schema: updated.schema,
            },
          }
        }

        case 'update_workflow_group': {
          if (!args.tableId) return { success: false, message: 'Table ID is required' }
          if (!workspaceId) return { success: false, message: 'Workspace ID is required' }
          const groupId = args.groupId as string | undefined
          if (!groupId) {
            return { success: false, message: 'groupId is required for update_workflow_group' }
          }
          const tableForUpdate = await getTableById(args.tableId)
          if (!tableForUpdate || tableForUpdate.workspaceId !== workspaceId) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }
          const updateOutputs = args.outputs as WorkflowGroupOutput[] | undefined
          if (updateOutputs && updateOutputs.length > 0) {
            // Resolve which workflow these outputs apply to: explicit override
            // wins, else the existing group's workflowId.
            const existingGroup = tableForUpdate.schema.workflowGroups?.find(
              (g) => g.id === groupId
            )
            const targetWorkflowId =
              (args.workflowId as string | undefined) ?? existingGroup?.workflowId
            if (!targetWorkflowId) {
              return {
                success: false,
                message: `Cannot validate outputs — workflow group ${groupId} not found and no workflowId provided`,
              }
            }
            const flattened = await loadFlattenedWorkflowOutputs(targetWorkflowId)
            if (!flattened) {
              return {
                success: false,
                message: `Workflow not found or has no blocks: ${targetWorkflowId}`,
              }
            }
            const validationError = validateOutputsAgainstWorkflow(
              updateOutputs.map((o) => ({ blockId: o.blockId, path: o.path })),
              flattened,
              targetWorkflowId
            )
            if (validationError) {
              return { success: false, message: validationError }
            }
          }
          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const updated = await updateWorkflowGroup(
            {
              tableId: args.tableId,
              groupId,
              workflowId: args.workflowId as string | undefined,
              name: args.name as string | undefined,
              dependencies: args.dependencies as WorkflowGroupDependencies | undefined,
              outputs: updateOutputs,
              newOutputColumns: args.newOutputColumns as ColumnDefinition[] | undefined,
            },
            requestId
          )
          return {
            success: true,
            message: `Updated workflow group ${groupId}`,
            data: { schema: updated.schema },
          }
        }

        case 'delete_workflow_group': {
          if (!args.tableId) return { success: false, message: 'Table ID is required' }
          if (!workspaceId) return { success: false, message: 'Workspace ID is required' }
          const groupId = args.groupId as string | undefined
          if (!groupId) {
            return { success: false, message: 'groupId is required for delete_workflow_group' }
          }
          const tableForDelete = await getTableById(args.tableId)
          if (!tableForDelete || tableForDelete.workspaceId !== workspaceId) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }
          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const updated = await deleteWorkflowGroup({ tableId: args.tableId, groupId }, requestId)
          return {
            success: true,
            message: `Deleted workflow group ${groupId}`,
            data: { schema: updated.schema },
          }
        }

        case 'add_workflow_group_output': {
          if (!args.tableId) return { success: false, message: 'Table ID is required' }
          if (!workspaceId) return { success: false, message: 'Workspace ID is required' }
          const groupId = args.groupId as string | undefined
          const blockId = args.blockId as string | undefined
          const path = args.path as string | undefined
          const columnName = args.columnName as string | undefined
          if (!groupId || !blockId || !path) {
            return {
              success: false,
              message: 'groupId, blockId, and path are required for add_workflow_group_output',
            }
          }
          const tableForAdd = await getTableById(args.tableId)
          if (!tableForAdd || tableForAdd.workspaceId !== workspaceId) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }
          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const updated = await addWorkflowGroupOutput(
            { tableId: args.tableId, groupId, blockId, path, columnName },
            requestId
          )
          return {
            success: true,
            message: `Added output to workflow group ${groupId}`,
            data: { schema: updated.schema },
          }
        }

        case 'delete_workflow_group_output': {
          if (!args.tableId) return { success: false, message: 'Table ID is required' }
          if (!workspaceId) return { success: false, message: 'Workspace ID is required' }
          const groupId = args.groupId as string | undefined
          const columnName = args.columnName as string | undefined
          if (!groupId || !columnName) {
            return {
              success: false,
              message: 'groupId and columnName are required for delete_workflow_group_output',
            }
          }
          const tableForRemove = await getTableById(args.tableId)
          if (!tableForRemove || tableForRemove.workspaceId !== workspaceId) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }
          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const updated = await deleteWorkflowGroupOutput(
            { tableId: args.tableId, groupId, columnName },
            requestId
          )
          return {
            success: true,
            message: `Removed output "${columnName}" from workflow group ${groupId}`,
            data: { schema: updated.schema },
          }
        }

        case 'run_workflow_group': {
          if (!args.tableId) return { success: false, message: 'Table ID is required' }
          if (!workspaceId) return { success: false, message: 'Workspace ID is required' }
          const groupId = args.groupId as string | undefined
          if (!groupId) {
            return { success: false, message: 'groupId is required for run_workflow_group' }
          }
          const runMode = (args.runMode as 'all' | 'incomplete' | undefined) ?? 'incomplete'
          if (runMode !== 'all' && runMode !== 'incomplete') {
            return {
              success: false,
              message: `Invalid runMode "${runMode}". Must be "all" or "incomplete"`,
            }
          }
          const rawRowIds = args.rowIds as unknown
          let rowIds: string[] | undefined
          if (rawRowIds !== undefined) {
            if (
              !Array.isArray(rawRowIds) ||
              rawRowIds.length === 0 ||
              rawRowIds.some((id) => typeof id !== 'string' || id.length === 0)
            ) {
              return {
                success: false,
                message: 'rowIds must be a non-empty array of row id strings',
              }
            }
            rowIds = rawRowIds as string[]
          }
          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const { triggered } = await triggerWorkflowGroupRun({
            tableId: args.tableId,
            groupId,
            workspaceId,
            mode: runMode,
            requestId,
            rowIds,
          })
          const scopeLabel = rowIds ? `${rowIds.length} row(s) by id` : runMode
          return {
            success: true,
            message: `Triggered ${triggered} row(s) for workflow group ${groupId} (${scopeLabel})`,
            data: { triggered },
          }
        }

        case 'cancel_table_runs': {
          if (!args.tableId) return { success: false, message: 'Table ID is required' }
          if (!workspaceId) return { success: false, message: 'Workspace ID is required' }
          const scope = (args.scope as 'all' | 'row' | undefined) ?? 'all'
          if (scope !== 'all' && scope !== 'row') {
            return {
              success: false,
              message: `Invalid scope "${scope}". Must be "all" or "row"`,
            }
          }
          const rowId = args.rowId as string | undefined
          if (scope === 'row' && !rowId) {
            return { success: false, message: 'rowId is required when scope is "row"' }
          }
          const tableForCancel = await getTableById(args.tableId)
          if (!tableForCancel || tableForCancel.workspaceId !== workspaceId) {
            return { success: false, message: `Table not found: ${args.tableId}` }
          }
          assertNotAborted()
          const cancelled = await cancelWorkflowGroupRuns(
            args.tableId,
            scope === 'row' ? rowId : undefined
          )
          return {
            success: true,
            message: `Cancelled ${cancelled} run(s)`,
            data: { cancelled },
          }
        }

        default:
          return { success: false, message: `Unknown operation: ${operation}` }
      }
    } catch (error) {
      const errorMessage = toError(error).message
      const cause = error instanceof Error && error.cause ? toError(error.cause).message : undefined
      logger.error('Table operation failed', {
        operation,
        error: errorMessage,
        cause,
      })
      const displayMessage = cause ? `${errorMessage} (${cause})` : errorMessage
      return { success: false, message: `Operation failed: ${displayMessage}` }
    }
  },
}
