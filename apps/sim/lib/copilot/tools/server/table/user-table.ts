import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { executeCopilotTableUseCase } from '@/lib/copilot/application/execute-table-use-case'
import { executeCopilotResolveWorkflowOutputs } from '@/lib/copilot/application/execute-workflow-use-case'
import {
  executeCopilotAddWorkflowTableGroupOutput,
  executeCopilotCreateTableEnrichmentGroup,
  executeCopilotCreateTableFromWorkspaceFile,
  executeCopilotCreateWorkflowTableGroup,
  executeCopilotDeleteTables,
  executeCopilotImportWorkspaceFileIntoTable,
  executeCopilotUpdateWorkflowTableGroup,
} from '@/lib/copilot/application/table-commands'
import { messageForCopilotTableError } from '@/lib/copilot/auth/table-delegation'
import { UserTable } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { COLUMN_TYPES, CSV_MAX_BATCH_SIZE, type CsvHeaderMapping, TABLE_LIMITS } from '@/lib/table'
import {
  addTableColumnUseCase,
  deleteTableColumnsUseCase,
  deleteTableColumnUseCase,
  updateTableColumnUseCase,
} from '@/lib/table/application/columns'
import {
  copilotDeleteRowsByFilter,
  copilotUpdateRowsByFilter,
} from '@/lib/table/application/copilot-bulk-rows'
import {
  deleteTableGroupOutputUseCase,
  deleteTableGroupUseCase,
} from '@/lib/table/application/groups'
import {
  batchUpdateTableRows,
  createTableRows,
  deleteTableRow,
  deleteTableRows,
  queryTableRows,
  readTableRow,
  updateTableRow,
} from '@/lib/table/application/rows'
import { cancelTableRuns, startTableRun } from '@/lib/table/application/runs'
import {
  createTableUseCase,
  readTableUseCase,
  updateTableUseCase,
} from '@/lib/table/application/tables'
import { readTableViewUseCase } from '@/lib/table/application/views'
import { namedRowMapper } from '@/lib/table/cell-format'
import { isSupportedCurrencyCode } from '@/lib/table/currency'
import type { TableImportRejectionSummary } from '@/lib/table/jobs/service'
import { normalizeTablePredicate } from '@/lib/table/query-builder/predicate'
import { createExactEmptyTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'
import { normalizeSelectOptionsInput } from '@/lib/table/select-options'
import type {
  RowData,
  SortSpec,
  TablePredicate,
  TablePredicateInput,
  TableSchema,
  WorkflowGroupDependencies,
} from '@/lib/table/types'
import { viewConfigIdsToNames } from '@/lib/table/views/service'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'

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

/**
 * Renders the sentence an import appends when it lost data, mirroring the
 * `droppedRows` phrasing so the model reads one shape for "the file did not
 * land whole".
 *
 * `rowsRejected` is a FLOOR — one parser failure can discard many source
 * records and is counted once — so the wording says "at least". Only the first
 * retained sample is named; the rest ride on `data.rejections` rather than
 * bloating a model-facing string.
 *
 * Returns `''` when nothing was lost, keeping a clean import's message
 * byte-identical to what it has always been.
 */
function rejectionSentence(rejections: TableImportRejectionSummary | undefined): string {
  if (!rejections) return ''
  const losses: string[] = []
  if (rejections.rowsRejected > 0) {
    losses.push(`at least ${rejections.rowsRejected.toLocaleString()} unreadable row(s)`)
  }
  if (rejections.cellsRejected > 0) {
    losses.push(
      `${rejections.cellsRejected.toLocaleString()} cell value(s) the column type could not store (kept as null)`
    )
  }
  if (losses.length === 0) return ''
  const sample = rejections.rejectedSamples[0]
  const firstFailure = sample
    ? ` First failure: ${sample.code}${sample.line === null ? '' : ` at line ${sample.line}`}.`
    : ''
  return `. Dropped ${losses.join(' and ')} from the file.${firstFailure} See data.rejections for details.`
}

/**
 * Copilot's own batch ceiling, deliberately looser than the 1000 the internal
 * and v2 batch-update contracts declare: Copilot parses no contract, so this is
 * the only place the tool can refuse an oversized batch with a message the model
 * can act on rather than a thrown domain error — and a batch it accepts today
 * must keep working.
 */
const MAX_BATCH_SIZE = CSV_MAX_BATCH_SIZE

function resolveAuthorizedWorkflowOutputs(
  workflowId: string,
  workspaceId: string,
  context: ServerToolContext
) {
  return executeCopilotResolveWorkflowOutputs(context, {
    workflowId,
    assertedWorkspaceId: workspaceId,
  })
}

/** Validates an optional row limit against the policy for the requested surface operation. */
function limitError(limit: unknown, max?: number): string | null {
  if (limit === undefined) return null
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    return 'Limit must be an integer of at least 1'
  }
  if (max !== undefined && limit > max) {
    return `Limit cannot exceed ${max}`
  }
  return null
}

/**
 * Normalizes agent-authored `select` options into the stored `{ id, name }`
 * shape. The copilot agent supplies option **names** (a bare string, or an
 * object with a `name`); the stable option id is generated here so the model
 * never authors the cell key. An entry that already carries a non-empty `id`
 * (e.g. re-sending an existing option on an options edit) keeps it, so existing
 * cell data survives the update. Non-array input returns `undefined`, letting
 * downstream validation reject a malformed / missing option set.
 */
/** Rewrites every `select` column's options in an agent-authored create schema. */
function normalizeSchemaSelectColumns(schema: TableSchema): TableSchema {
  if (!schema || !Array.isArray(schema.columns)) return schema
  return {
    ...schema,
    columns: schema.columns.map((col) =>
      col.type === 'select' ? { ...col, options: normalizeSelectOptionsInput(col.options) } : col
    ),
  }
}

async function importRowsProvenanceForModel(
  provenance: ResolvedSecretTraceProvenanceV1 | undefined,
  values: unknown[],
  context: ServerToolContext
): Promise<void> {
  const registry = context.resolvedSecretTraceRegistry
  if (!registry) return
  if (!provenance) {
    registry.markIncomplete('table-result-provenance-unavailable')
    return
  }
  await registry.importCrossingProvenance(provenance, values, { trusted: true })
}

/** AND-combines a saved view's predicate with an explicit one; either may be absent. */
function mergeViewPredicate(
  viewFilter: TablePredicateInput | undefined,
  explicit: TablePredicateInput | undefined
): TablePredicate | undefined {
  const parts: TablePredicate[] = []
  if (viewFilter) parts.push(normalizeTablePredicate(viewFilter))
  if (explicit) parts.push(normalizeTablePredicate(explicit))
  if (parts.length === 0) return undefined
  if (parts.length === 1) return parts[0]
  return { all: parts }
}

export const userTableServerTool: BaseServerTool<UserTableArgs, UserTableResult> = {
  name: UserTable.id,
  async execute(params: UserTableArgs, context?: ServerToolContext): Promise<UserTableResult> {
    if (!context?.userId) {
      logger.error('Unauthorized attempt to access user table - no authenticated user context')
      throw new Error('Authentication required')
    }

    const { operation, args = {} } = params
    const workspaceId = context.workspaceId
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

          assertNotAborted()
          const { table } = await executeCopilotTableUseCase(context, createTableUseCase, {
            name: args.name,
            description: args.description,
            schema: normalizeSchemaSelectColumns(args.schema as TableSchema),
            folderPath: args.folderPath,
            workspaceId,
          })

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

          const { table } = await executeCopilotTableUseCase(
            context,
            readTableUseCase,
            { tableId: args.tableId, workspaceId },
            { tableId: args.tableId }
          )

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

          const { table } = await executeCopilotTableUseCase(
            context,
            readTableUseCase,
            { tableId: args.tableId, workspaceId },
            { tableId: args.tableId }
          )

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
          if (tableIds.length > TABLE_LIMITS.MAX_TABLES_PER_WORKSPACE) {
            return {
              success: false,
              message: `Cannot delete more than ${TABLE_LIMITS.MAX_TABLES_PER_WORKSPACE} tables at once`,
            }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          assertNotAborted()
          const { deleted: archived, failed } = await executeCopilotDeleteTables(context, {
            tableIds,
            workspaceId,
            assertNotAborted,
          })
          const deleted = archived.map((table) => table.id)

          return {
            success: deleted.length > 0,
            message: `Deleted ${deleted.length} table(s)${failed.length > 0 ? `, ${failed.length} not found` : ''}`,
            data: { deleted, failed },
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

          assertNotAborted()
          const result = await executeCopilotTableUseCase(
            context,
            createTableRows,
            {
              kind: 'single',
              tableId: args.tableId,
              assertedWorkspaceId: workspaceId,
              strictWrite: false,
              dataKeying: 'names',
              data: args.data,
              position: args.position as number | undefined,
              secretProvenance: createExactEmptyTableRowSecretProvenance(args.data),
            },
            { tableId: args.tableId }
          )
          if (result.kind !== 'single') throw new Error('Single row insert returned a batch')
          const { table, row } = result
          const toNamedRow = namedRowMapper(table.schema.columns)

          return {
            success: true,
            message: `Inserted row ${row.id}`,
            data: {
              row: {
                ...row,
                data: toNamedRow(row.data),
              },
            },
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

          assertNotAborted()
          const sourceRows = args.rows as RowData[]
          const result = await executeCopilotTableUseCase(
            context,
            createTableRows,
            {
              kind: 'batch',
              tableId: args.tableId,
              assertedWorkspaceId: workspaceId,
              strictWrite: false,
              dataKeying: 'names',
              rows: sourceRows,
              secretProvenance: sourceRows.map(createExactEmptyTableRowSecretProvenance),
            },
            { tableId: args.tableId }
          )
          if (result.kind !== 'batch') throw new Error('Batch row insert returned one row')
          const { table, rows } = result
          const toNamedRow = namedRowMapper(table.schema.columns)

          return {
            success: true,
            message: `Inserted ${rows.length} rows`,
            data: {
              rows: rows.map((r) => ({
                ...r,
                data: toNamedRow(r.data),
              })),
              insertedCount: rows.length,
            },
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

          const {
            table: rowTable,
            row,
            secretProvenance,
          } = await executeCopilotTableUseCase(
            context,
            readTableRow,
            {
              tableId: args.tableId,
              assertedWorkspaceId: workspaceId,
              rowId: args.rowId,
              includePersistedSecretProvenance: Boolean(context.resolvedSecretTraceRegistry),
            },
            { tableId: args.tableId }
          )
          await importRowsProvenanceForModel(secretProvenance, [row.data], context)

          const toNamedRow = namedRowMapper(rowTable.schema.columns)
          return {
            success: true,
            message: `Row ${row.id}`,
            data: {
              row: {
                ...row,
                data: toNamedRow(row.data),
              },
            },
          }
        }

        case 'query_rows': {
          if (!args.tableId) {
            return { success: false, message: 'Table ID is required' }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          // Saved-view scope: the view's stored filter ANDs with any explicit
          // filter (query-within-the-view), its sort applies only when no
          // explicit order is given, and layout fields (hidden columns, order,
          // widths) are ignored — agents always see full rows. Views are
          // referenced by id only (from views.json or table_views list_views).
          let viewFilter: TablePredicateInput | undefined
          let viewSort: SortSpec | undefined
          let appliedViewName: string | undefined
          if (typeof args.view === 'string' && args.view.trim() !== '') {
            const viewId = (args.view as string).trim()
            const resolved = await executeCopilotTableUseCase(
              context,
              readTableViewUseCase,
              { tableId: args.tableId, workspaceId, viewId },
              { tableId: args.tableId }
            )
            const named = viewConfigIdsToNames(
              resolved.view.config,
              (resolved.table.schema as TableSchema).columns
            )
            viewFilter = (named.filter as TablePredicateInput | null) ?? undefined
            viewSort = (named.sort as SortSpec | null) ?? undefined
            appliedViewName = resolved.view.name
          }

          const queryLimitError = limitError(args.limit, TABLE_LIMITS.MAX_QUERY_LIMIT)
          if (queryLimitError) {
            return { success: false, message: queryLimitError }
          }

          const result = await executeCopilotTableUseCase(
            context,
            queryTableRows,
            {
              tableId: args.tableId,
              assertedWorkspaceId: workspaceId,
              predicate: mergeViewPredicate(
                viewFilter,
                args.filter as TablePredicateInput | undefined
              ),
              sort: (args.order as SortSpec | undefined) ?? viewSort,
              limit: args.limit ?? TABLE_LIMITS.MAX_QUERY_LIMIT,
              cursor: args.cursor,
              includeTotal: !args.cursor,
              includePersistedSecretProvenance: Boolean(context.resolvedSecretTraceRegistry),
            },
            { tableId: args.tableId }
          )
          const { table, secretProvenance, ...queryResult } = result
          const toNamedRow = namedRowMapper(table.schema.columns)
          await importRowsProvenanceForModel(
            secretProvenance,
            result.rows.map((row) => row.data),
            context
          )

          // nextCursor covers both cut kinds (explicit limit or the 5MB byte
          // budget) — either way the truthful signal is "more rows exist". The
          // token is opaque; the agent echoes it back as `cursor` to continue.
          const viewSuffix = appliedViewName ? ` (view: ${appliedViewName})` : ''
          const countSuffix =
            (result.totalCount != null ? ` of ${result.totalCount}` : '') + viewSuffix
          const message = result.nextCursor
            ? `Returned ${result.rows.length}${countSuffix} rows (more available — pass cursor=${result.nextCursor} to continue)`
            : `Returned ${result.rows.length}${countSuffix} rows`
          return {
            success: true,
            message,
            data: {
              ...queryResult,
              rows: result.rows.map((r) => ({
                ...r,
                data: toNamedRow(r.data),
              })),
            },
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

          assertNotAborted()
          const {
            table,
            row: updatedRow,
            secretProvenance,
          } = await executeCopilotTableUseCase(
            context,
            updateTableRow,
            {
              tableId: args.tableId,
              assertedWorkspaceId: workspaceId,
              strictWrite: false,
              dataKeying: 'names',
              rowId: args.rowId,
              data: args.data,
              secretProvenance: createExactEmptyTableRowSecretProvenance(args.data),
              includePersistedSecretProvenance: Boolean(context.resolvedSecretTraceRegistry),
            },
            { tableId: args.tableId }
          )
          const toNamedRow = namedRowMapper(table.schema.columns)
          await importRowsProvenanceForModel(secretProvenance, [updatedRow.data], context)

          return {
            success: true,
            message: `Updated row ${updatedRow.id}`,
            data: {
              row: {
                ...updatedRow,
                data: toNamedRow(updatedRow.data),
              },
            },
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

          assertNotAborted()
          await executeCopilotTableUseCase(
            context,
            deleteTableRow,
            {
              tableId: args.tableId,
              assertedWorkspaceId: workspaceId,
              rowId: args.rowId,
            },
            { tableId: args.tableId }
          )

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
          const updateLimitError = limitError(args.limit)
          if (updateLimitError) {
            return { success: false, message: updateLimitError }
          }

          assertNotAborted()
          const result = await executeCopilotTableUseCase(
            context,
            copilotUpdateRowsByFilter,
            {
              tableId: args.tableId,
              assertedWorkspaceId: workspaceId,
              filter: normalizeTablePredicate(args.filter as TablePredicateInput),
              data: args.data as RowData,
              limit: args.limit,
            },
            { tableId: args.tableId }
          )
          if (result.kind === 'background') {
            return {
              success: true,
              message: `Started background update of ${result.affectedCount} matching rows (job ${result.jobId}). Rows update in the background — query_rows to check progress. Note: background updates don't auto-recompute workflow/enrichment columns; use run_column afterward if needed.`,
              data: { jobId: result.jobId, affectedCount: result.affectedCount },
            }
          }

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
          const deleteLimitError = limitError(args.limit)
          if (deleteLimitError) {
            return { success: false, message: deleteLimitError }
          }

          assertNotAborted()
          const result = await executeCopilotTableUseCase(
            context,
            copilotDeleteRowsByFilter,
            {
              tableId: args.tableId,
              assertedWorkspaceId: workspaceId,
              filter: normalizeTablePredicate(args.filter as TablePredicateInput),
              limit: args.limit,
            },
            { tableId: args.tableId }
          )
          if (result.kind === 'background') {
            return {
              success: true,
              message: result.bounded
                ? `Started background delete of up to ${result.doomedCount} matching rows (job ${result.jobId}). Rows delete in the background — query_rows to check progress.`
                : `Started background delete of ${result.doomedCount} matching rows (job ${result.jobId}). The rows are hidden from reads immediately — query_rows already reflects the post-delete view.`,
              data: { jobId: result.jobId, doomedCount: result.doomedCount },
            }
          }

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

          assertNotAborted()
          const result = await executeCopilotTableUseCase(
            context,
            batchUpdateTableRows,
            {
              tableId: args.tableId,
              assertedWorkspaceId: workspaceId,
              updates: updates as Array<{ rowId: string; data: RowData }>,
              strictWrite: false,
              dataKeying: 'names' as const,
            },
            { tableId: args.tableId }
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

          assertNotAborted()
          const result = await executeCopilotTableUseCase(
            context,
            deleteTableRows,
            {
              kind: 'ids',
              tableId: args.tableId,
              assertedWorkspaceId: workspaceId,
              rowIds,
            },
            { tableId: args.tableId }
          )
          if (result.kind !== 'ids') throw new Error('Row ID deletion returned a filter result')

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
                'fileId or filePath is required for create_from_file. Use a canonical VFS path from glob("files/**") or a file ID from read("files/{path}/{name}").',
            }
          }
          if (!workspaceId) {
            return { success: false, message: 'Workspace ID is required' }
          }

          assertNotAborted()
          const result = await executeCopilotCreateTableFromWorkspaceFile(context, {
            workspaceId,
            fileReference,
            name: args.name,
            description: args.description,
            assertNotAborted,
          })
          if (result.kind === 'empty') {
            return {
              success: false,
              message:
                'File yielded no readable data rows — it is either empty or every record failed to parse.',
            }
          }
          const record = result.sourceFile
          if (result.kind === 'background') {
            return {
              success: true,
              message: `Created table "${result.table.name}" (${result.table.id}); importing rows from "${record.name}" in the background (job ${result.jobId}). Columns and rows appear as the import progresses — query_rows to check what has landed.`,
              data: {
                tableId: result.table.id,
                tableName: result.table.name,
                jobId: result.jobId,
                sourceFile: record.name,
              },
            }
          }

          const createdMessage = `Created table "${result.table.name}" with ${result.columns.length} columns and ${result.insertedCount.toLocaleString()} rows from "${record.name}"`
          const limitMessage =
            result.droppedRows > 0
              ? `${createdMessage}. Dropped ${result.droppedRows.toLocaleString()} row(s) that exceed this plan's limit of ${result.maxRowsPerTable.toLocaleString()} rows per table.`
              : createdMessage
          const message = `${limitMessage}${rejectionSentence(result.rejections)}`

          return {
            success: true,
            message,
            data: {
              tableId: result.table.id,
              tableName: result.table.name,
              columns: result.columns.map((column) => ({
                name: column.name,
                type: column.type,
              })),
              rowCount: result.insertedCount,
              sourceFile: record.name,
              ...(result.rejections ? { rejections: result.rejections } : {}),
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
                'fileId or filePath is required for import_file. Use a canonical VFS path from glob("files/**") or a file ID from read("files/{path}/{name}").',
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

          assertNotAborted()
          const result = await executeCopilotImportWorkspaceFileIntoTable(context, {
            tableId,
            assertedWorkspaceId: workspaceId,
            fileReference,
            mode,
            mapping: rawMapping,
            assertNotAborted,
          })
          if (result.kind === 'background') {
            return {
              success: true,
              message: `Started background ${mode} import of "${result.sourceFileName}" into "${result.table.name}" (job ${result.jobId}). Rows appear as the import progresses — query_rows to check what has landed.`,
              data: { tableId: result.table.id, jobId: result.jobId, mode },
            }
          }
          if (result.kind === 'empty') {
            return {
              success: false,
              message:
                'File yielded no readable data rows — it is either empty or every record failed to parse.',
            }
          }
          if (result.kind !== 'inline')
            throw new Error('Inline table import returned a background job')
          if (result.mode === 'replace') {
            return {
              success: true,
              message: `Replaced rows in "${result.table.name}" from "${result.sourceFileName}": deleted ${result.deletedCount}, inserted ${result.insertedCount}${rejectionSentence(result.rejections)}`,
              data: {
                tableId: result.table.id,
                tableName: result.table.name,
                mode,
                matchedColumns: result.matchedColumns,
                skippedColumns: result.skippedColumns,
                deletedCount: result.deletedCount,
                insertedCount: result.insertedCount,
                sourceFile: result.sourceFileName,
                ...(result.rejections ? { rejections: result.rejections } : {}),
              },
            }
          }
          return {
            success: true,
            message: `Imported ${result.insertedCount} rows into "${result.table.name}" from "${result.sourceFileName}" (${result.matchedColumns.length} columns matched)${rejectionSentence(result.rejections)}`,
            data: {
              tableId: result.table.id,
              tableName: result.table.name,
              mode,
              matchedColumns: result.matchedColumns,
              skippedColumns: result.skippedColumns,
              rowCount: result.insertedCount,
              sourceFile: result.sourceFileName,
              ...(result.rejections ? { rejections: result.rejections } : {}),
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
                options?: unknown
                multiple?: boolean
                currencyCode?: string
              }
            | undefined
          if (!col?.name || !col?.type) {
            return {
              success: false,
              message: 'column with name and type is required for add_column',
            }
          }
          assertNotAborted()
          if (col.currencyCode !== undefined && !isSupportedCurrencyCode(col.currencyCode)) {
            return {
              success: false,
              message: `Invalid currency code "${col.currencyCode}". Use an ISO 4217 code, e.g. USD`,
            }
          }
          // Agent authors select options by name; generate their stable ids here.
          const columnToAdd =
            col.type === 'select'
              ? { ...col, options: normalizeSelectOptionsInput(col.options) }
              : { ...col, options: undefined }
          const { table: updated } = await executeCopilotTableUseCase(
            context,
            addTableColumnUseCase,
            { tableId: args.tableId, workspaceId, column: columnToAdd },
            { tableId: args.tableId }
          )
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
          assertNotAborted()
          const { table: updated } = await executeCopilotTableUseCase(
            context,
            updateTableColumnUseCase,
            {
              tableId: args.tableId,
              workspaceId,
              columnName: colName,
              updates: { name: newColName },
            },
            { tableId: args.tableId }
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
          if (names.length === 1) {
            assertNotAborted()
            const { table: updated } = await executeCopilotTableUseCase(
              context,
              deleteTableColumnUseCase,
              { tableId: args.tableId, workspaceId, columnName: names[0] },
              { tableId: args.tableId }
            )
            return {
              success: true,
              message: `Deleted column "${names[0]}"`,
              data: { schema: updated.schema },
            }
          }
          assertNotAborted()
          const { table: updated, deletedColumns } = await executeCopilotTableUseCase(
            context,
            deleteTableColumnsUseCase,
            { tableId: args.tableId, workspaceId, columnNames: names },
            { tableId: args.tableId }
          )
          return {
            success: true,
            message: `Deleted ${deletedColumns.length} ${deletedColumns.length === 1 ? 'column' : 'columns'}: ${deletedColumns
              .map((column) => column.name)
              .join(', ')}`,
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
          const rawOptions = (args as Record<string, unknown>).options
          const multiple = (args as Record<string, unknown>).multiple as boolean | undefined
          const currencyCode = (args as Record<string, unknown>).currencyCode as string | undefined
          if (
            newType === undefined &&
            uniqFlag === undefined &&
            rawOptions === undefined &&
            multiple === undefined &&
            currencyCode === undefined
          ) {
            return {
              success: false,
              message:
                'At least one of newType, unique, options, multiple, or currencyCode must be provided',
            }
          }
          if (currencyCode !== undefined && !isSupportedCurrencyCode(currencyCode)) {
            return {
              success: false,
              message: `Invalid currency code "${currencyCode}". Use an ISO 4217 code, e.g. USD`,
            }
          }
          if (newType !== undefined && !(COLUMN_TYPES as readonly string[]).includes(newType)) {
            return {
              success: false,
              message: `Invalid column type "${newType}". Must be one of: ${COLUMN_TYPES.join(', ')}`,
            }
          }
          assertNotAborted()
          const { table: updated } = await executeCopilotTableUseCase(
            context,
            updateTableColumnUseCase,
            {
              tableId: args.tableId,
              workspaceId,
              columnName: colName,
              updates: {
                ...(newType !== undefined
                  ? { type: newType as (typeof COLUMN_TYPES)[number] }
                  : {}),
                ...(uniqFlag !== undefined ? { unique: uniqFlag } : {}),
                ...(rawOptions !== undefined ? { options: rawOptions } : {}),
                ...(multiple !== undefined ? { multiple } : {}),
                ...(currencyCode !== undefined ? { currencyCode } : {}),
              },
            },
            { tableId: args.tableId }
          )
          return {
            success: true,
            message: `Updated column "${colName}"`,
            data: { schema: updated.schema },
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

          assertNotAborted()
          const result = await executeCopilotTableUseCase(
            context,
            updateTableUseCase,
            { tableId: args.tableId, workspaceId, name: newName },
            { tableId: args.tableId }
          )
          if (result.failure) {
            throw result.failure
          }

          return {
            success: true,
            message: `Renamed table to "${newName}"`,
            data: { table: { id: args.tableId, name: result.table?.name ?? newName } },
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
          const resolvedWorkflow = await resolveAuthorizedWorkflowOutputs(
            workflowId,
            workspaceId,
            context
          )
          const flattened = resolvedWorkflow.outputs
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
          for (const o of rawOutputs) {
            if (!o.blockId || !o.path) {
              return {
                success: false,
                message: 'Each output entry must include both blockId and path',
              }
            }
          }

          const dependencies = args.dependencies as WorkflowGroupDependencies | undefined
          const name = args.name as string | undefined
          assertNotAborted()
          const autoRun = args.autoRun === true
          const { table: updated, group } = await executeCopilotCreateWorkflowTableGroup(context, {
            tableId: args.tableId,
            workspaceId,
            workflowId,
            outputs: rawOutputs,
            name,
            dependencies,
            autoRun,
          })
          return {
            success: true,
            message: `Added workflow group "${name ?? group.id}" with ${group.outputs.length} output column(s)`,
            data: {
              groupId: group.id,
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
          const updateOutputs = args.outputs as
            | Array<{
                blockId: string
                path: string
                columnName?: string
                columnType?: string
              }>
            | undefined
          const mappingUpdates = args.mappingUpdates as
            | Array<{ columnName: string; blockId: string; path: string }>
            | undefined
          const explicitWorkflowId = args.workflowId as string | undefined
          assertNotAborted()
          const { table: updated } = await executeCopilotUpdateWorkflowTableGroup(context, {
            tableId: args.tableId,
            workspaceId,
            groupId,
            workflowId: explicitWorkflowId,
            name: args.name as string | undefined,
            dependencies: args.dependencies as WorkflowGroupDependencies | undefined,
            outputs: updateOutputs,
            mappingUpdates,
            autoRun: typeof args.autoRun === 'boolean' ? args.autoRun : undefined,
          })
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
          assertNotAborted()
          const { table: updated } = await executeCopilotTableUseCase(
            context,
            deleteTableGroupUseCase,
            { tableId: args.tableId, workspaceId, groupId },
            { tableId: args.tableId }
          )
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
          assertNotAborted()
          const { table: updated } = await executeCopilotAddWorkflowTableGroupOutput(context, {
            tableId: args.tableId,
            workspaceId,
            groupId,
            blockId,
            path,
            columnName,
          })
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
          assertNotAborted()
          const { table: updated } = await executeCopilotTableUseCase(
            context,
            deleteTableGroupOutputUseCase,
            { tableId: args.tableId, groupId, columnName, workspaceId },
            { tableId: args.tableId }
          )
          return {
            success: true,
            message: `Removed output "${columnName}" from workflow group ${groupId}`,
            data: { schema: updated.schema },
          }
        }

        case 'run_column': {
          if (!args.tableId) return { success: false, message: 'Table ID is required' }
          if (!workspaceId) return { success: false, message: 'Workspace ID is required' }
          const rawGroupIds = args.groupIds as unknown
          if (
            !Array.isArray(rawGroupIds) ||
            rawGroupIds.length === 0 ||
            rawGroupIds.some((id) => typeof id !== 'string' || id.length === 0)
          ) {
            return {
              success: false,
              message: 'groupIds must be a non-empty array of group id strings',
            }
          }
          const groupIds = rawGroupIds as string[]
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
          assertNotAborted()
          const { dispatchId } = await executeCopilotTableUseCase(
            context,
            startTableRun,
            {
              kind: 'selection',
              tableId: args.tableId,
              assertedWorkspaceId: workspaceId,
              groupIds,
              mode: runMode,
              rowIds,
            },
            { tableId: args.tableId }
          )
          const scopeLabel = rowIds ? `${rowIds.length} row(s) by id` : runMode
          return {
            success: true,
            message: `Started running ${groupIds.length} column(s) (${scopeLabel}). Cells will populate as workflows complete.`,
            data: { dispatchId },
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
          assertNotAborted()
          const { cancelled } = await executeCopilotTableUseCase(
            context,
            cancelTableRuns,
            scope === 'row'
              ? {
                  scope: 'row',
                  tableId: args.tableId,
                  assertedWorkspaceId: workspaceId,
                  rowId: rowId as string,
                }
              : {
                  scope: 'all',
                  tableId: args.tableId,
                  assertedWorkspaceId: workspaceId,
                },
            { tableId: args.tableId }
          )
          return {
            success: true,
            message: `Cancelled ${cancelled} run(s)`,
            data: { cancelled },
          }
        }

        case 'list_enrichments': {
          const { ALL_ENRICHMENTS } = await import('@/enrichments/registry')
          const enrichments = ALL_ENRICHMENTS.map((e) => ({
            id: e.id,
            name: e.name,
            description: e.description,
            inputs: e.inputs.map((i) => ({
              id: i.id,
              name: i.name,
              type: i.type,
              required: i.required ?? false,
            })),
            outputs: e.outputs.map((o) => ({ id: o.id, name: o.name, type: o.type })),
          }))
          return {
            success: true,
            message: `${enrichments.length} enrichment(s) available`,
            data: { enrichments },
          }
        }

        case 'add_enrichment': {
          if (!args.tableId) return { success: false, message: 'Table ID is required' }
          if (!workspaceId) return { success: false, message: 'Workspace ID is required' }
          const enrichmentId = args.enrichmentId as string | undefined
          if (!enrichmentId) {
            return { success: false, message: 'enrichmentId is required for add_enrichment' }
          }
          const rawMappings = args.inputMappings as
            | Array<{ inputName: string; columnName: string }>
            | undefined
          const autoRun = args.autoRun === true
          assertNotAborted()
          const { table: updated, group } = await executeCopilotCreateTableEnrichmentGroup(
            context,
            {
              tableId: args.tableId,
              workspaceId,
              enrichmentId,
              inputMappings: Array.isArray(rawMappings) ? rawMappings : undefined,
              outputColumnNames: (args.outputColumnNames ?? {}) as Record<string, string>,
              dependencies: args.dependencies as WorkflowGroupDependencies | undefined,
              name: args.name as string | undefined,
              autoRun,
            }
          )
          return {
            success: true,
            message: `Added enrichment "${group.name}" with ${group.outputs.length} output column(s)${
              autoRun ? ' (auto-run enabled)' : ' (staged — use run_column to fire rows)'
            }`,
            data: { groupId: group.id, schema: updated.schema },
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
      return {
        success: false,
        message: `Operation failed: ${messageForCopilotTableError(error)}`,
      }
    }
  },
}
