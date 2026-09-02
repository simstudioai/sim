import { createLogger } from '@sim/logger'
import type { AnyApiRouteContract, ApiSchema } from '@/lib/api/contracts'
import {
  createTableContract,
  deleteTableRowContract,
  deleteTableRowsContract,
  getTableContract,
  getTableRowContract,
  insertTableRowsContract,
  listTableRowsContract,
  listTablesContract,
  rowQueryContract,
  TABLE_QUERY_MAX_BODY_BYTES,
  updateTableRowContract,
  updateTableRowsByFilterContract,
  upsertTableRowContract,
} from '@/lib/api/contracts/tables'
import {
  tableCreateFolderResponseSchema,
  tableCreateFolderSchemas,
  tableDeleteFolderResponseSchema,
  tableDeleteFolderSchemas,
  tableListFoldersResponseSchema,
  tableListFoldersSchemas,
  tableMoveResponseSchema,
  tableMoveSchemas,
  tableRestoreFolderResponseSchema,
  tableRestoreFolderSchemas,
  tableUpdateFolderResponseSchema,
  tableUpdateFolderSchemas,
} from '@/lib/api/contracts/tools/table'
import { type InternalErrorPolicy, internalOrchestrationErrorPolicy } from '@/lib/api/server/routes'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import {
  executeTableCreate,
  executeTableCreateFolder,
  executeTableDeleteFolder,
  executeTableDeleteRow,
  executeTableDeleteRows,
  executeTableGetRow,
  executeTableGetSchema,
  executeTableInsertRows,
  executeTableList,
  executeTableListFolders,
  executeTableMove,
  executeTableQueryRows,
  executeTableQueryRowsV2,
  executeTableRestoreFolder,
  executeTableUpdateFolder,
  executeTableUpdateRow,
  executeTableUpdateRowsByFilter,
  executeTableUpsertRow,
  type TableToolOperationContext,
  type TableToolOperationResult,
} from '@/lib/internal/table/operations'
import { createTableToolResponse } from '@/lib/internal/table/provenance'
import {
  classifyInternalToolIdentityFault,
  internalToolIdentityFaultMessage,
  internalToolIdentityFaultStatus,
} from '@/lib/internal/tool-operations/identity-faults'
import {
  parseInternalContractInput,
  parseInternalOperationInput,
} from '@/lib/internal/tool-operations/parse-contract-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { internalTableErrorPolicies } from '@/lib/table/api/route-policies'
import {
  internalTableRowsErrorPolicy,
  internalTableV2QueryErrorPolicy,
} from '@/lib/table/api/row-route-policies'
import { TABLE_DELEGATION_AUDIENCE } from '@/lib/table/application/authorization'

const logger = createLogger('TableInternalOperation')

/**
 * Tools that address one table through an HTTP-shaped `{tableId, workspaceId}`
 * input, so their executor delegation can be scoped to it via `getTableContract`.
 *
 * The folder tools are absent because they address a folder by path and have no
 * table to bind a scope to. `table_move` does have one, but is scoped through
 * its own schema — see {@link resolveScopedTableId}.
 */
const TABLE_SCOPED_TOOLS = new Set([
  'table_get_schema',
  'table_get_row',
  'table_insert_row',
  'table_batch_insert_rows',
  'table_query_rows',
  'table_query_rows_v2',
  'table_update_row',
  'table_update_rows_by_filter',
  'table_delete_row',
  'table_delete_rows_by_filter',
  'table_upsert_row',
])

const ROW_TOOLS = new Set([
  'table_get_row',
  'table_insert_row',
  'table_batch_insert_rows',
  'table_query_rows',
  'table_query_rows_v2',
  'table_update_row',
  'table_update_rows_by_filter',
  'table_delete_row',
  'table_delete_rows_by_filter',
  'table_upsert_row',
])

const FAILURE_MESSAGES: Record<string, string> = {
  table_create: 'Failed to create table',
  table_list: 'Failed to list tables',
  table_get_schema: 'Failed to get table',
  table_get_row: 'Failed to get row',
  table_insert_row: 'Failed to insert row',
  table_batch_insert_rows: 'Failed to insert rows',
  table_query_rows: 'Failed to query rows',
  table_query_rows_v2: 'Failed to query rows',
  table_update_row: 'Failed to update row',
  table_update_rows_by_filter: 'Failed to update rows',
  table_delete_row: 'Failed to delete row',
  table_delete_rows_by_filter: 'Failed to delete rows',
  table_upsert_row: 'Failed to upsert row',
  table_list_folders: 'Failed to list table folders',
  table_create_folder: 'Failed to create table folder',
  table_update_folder: 'Failed to move table folder',
  table_delete_folder: 'Failed to delete table folder',
  table_restore_folder: 'Failed to restore table folder',
  table_move: 'Failed to move table',
}

type ScopeResolution = { success: true; tableId?: string } | { success: false; response: Response }

/**
 * The table an executor delegation is scoped to, resolved before the operation
 * runs so authority is narrowed rather than granted workspace-wide.
 *
 * The older tools carry an HTTP-shaped `{tableId, workspaceId}` and are read
 * through `getTableContract`. `table_move` cannot be: that contract's query
 * REQUIRES a `workspaceId`, and the folder-era tools deliberately send none —
 * the workspace is the principal's, never a value the caller asserts — so
 * reading it that way rejected every move as malformed. It reads its table id
 * from its own schema instead.
 */
function resolveScopedTableId(toolId: string, input: unknown): ScopeResolution {
  if (TABLE_SCOPED_TOOLS.has(toolId)) {
    const parsed = parseInternalContractInput(getTableContract, input)
    return parsed.success ? { success: true, tableId: parsed.data.params.tableId } : parsed
  }
  if (toolId === 'table_move') {
    const parsed = parseInternalOperationInput(tableMoveSchemas, input)
    return parsed.success ? { success: true, tableId: parsed.data.body.tableId } : parsed
  }
  return { success: true }
}

function errorPolicyForTool(toolId: string): InternalErrorPolicy {
  if (toolId === 'table_query_rows_v2') return internalTableV2QueryErrorPolicy
  if (ROW_TOOLS.has(toolId)) return internalTableRowsErrorPolicy
  if (toolId === 'table_get_schema') return internalTableErrorPolicies.concealTableAuthorization
  return internalOrchestrationErrorPolicy
}

function errorResponse(
  toolId: string,
  error: unknown,
  requestId: string,
  policy: InternalErrorPolicy
): Response {
  const projected = policy.project(error)
  if (projected) {
    return Response.json(projected.body, {
      status: projected.status,
      headers: projected.headers,
    })
  }
  logger.error(`[${requestId}] ${FAILURE_MESSAGES[toolId] ?? 'Table operation failed'}:`, error)
  return Response.json(
    { error: FAILURE_MESSAGES[toolId] ?? 'Table operation failed' },
    { status: 500 }
  )
}

/**
 * The schema a dispatched tool's result is validated against on the way out.
 *
 * A response schema rather than a whole contract, because the folder tools have
 * no HTTP route of their own — they are dispatched only from here — and a
 * `defineRouteContract` declaring a `method` and `path` nothing serves would be
 * fiction. The routed tools keep their contracts and hand over
 * `contract.response.schema`.
 */
interface DispatchedTableTool {
  responseSchema: ApiSchema
  result: TableToolOperationResult
}

function jsonResponseSchema(contract: AnyApiRouteContract): ApiSchema {
  if (contract.response.mode !== 'json') {
    throw new Error('Table tool contract must return JSON')
  }
  return contract.response.schema
}

async function dispatchTableTool(
  request: Parameters<InternalToolOperationHandler>[0],
  operationContext: TableToolOperationContext
): Promise<DispatchedTableTool | Response> {
  const dispatched = async (
    contract: AnyApiRouteContract,
    result: Promise<TableToolOperationResult>
  ) => {
    /*
     * Await first: `jsonResponseSchema` throwing before the await would leave an
     * already-started operation promise unhandled.
     */
    const settled = await result
    return { responseSchema: jsonResponseSchema(contract), result: settled }
  }

  /** The same, for an operation whose schemas are standalone rather than routed. */
  const dispatchedSchema = async (
    responseSchema: ApiSchema,
    result: Promise<TableToolOperationResult>
  ) => ({ responseSchema, result: await result })

  switch (request.toolId) {
    case 'table_create': {
      const parsed = parseInternalContractInput(createTableContract, request.input)
      return parsed.success
        ? dispatched(createTableContract, executeTableCreate(parsed.data.body, operationContext))
        : parsed.response
    }
    case 'table_list': {
      const parsed = parseInternalContractInput(listTablesContract, request.input)
      return parsed.success
        ? dispatched(listTablesContract, executeTableList(parsed.data.query, operationContext))
        : parsed.response
    }
    case 'table_get_schema': {
      const parsed = parseInternalContractInput(getTableContract, request.input)
      return parsed.success
        ? dispatched(
            getTableContract,
            executeTableGetSchema(parsed.data.params.tableId, operationContext)
          )
        : parsed.response
    }
    case 'table_get_row': {
      const parsed = parseInternalContractInput(getTableRowContract, request.input)
      return parsed.success
        ? dispatched(
            getTableRowContract,
            executeTableGetRow(
              parsed.data.params.tableId,
              parsed.data.params.rowId,
              parsed.data.query,
              operationContext
            )
          )
        : parsed.response
    }
    case 'table_insert_row':
    case 'table_batch_insert_rows': {
      const parsed = parseInternalContractInput(insertTableRowsContract, request.input)
      return parsed.success
        ? dispatched(
            insertTableRowsContract,
            executeTableInsertRows(parsed.data.params.tableId, parsed.data.body, operationContext)
          )
        : parsed.response
    }
    case 'table_query_rows': {
      const parsed = parseInternalContractInput(listTableRowsContract, request.input)
      return parsed.success
        ? dispatched(
            listTableRowsContract,
            executeTableQueryRows(parsed.data.params.tableId, parsed.data.query, operationContext)
          )
        : parsed.response
    }
    case 'table_query_rows_v2': {
      const parsed = parseInternalContractInput(rowQueryContract, request.input, {
        maxInputBytes: TABLE_QUERY_MAX_BODY_BYTES,
      })
      return parsed.success
        ? dispatched(
            rowQueryContract,
            executeTableQueryRowsV2(parsed.data.params.tableId, parsed.data.body, operationContext)
          )
        : parsed.response
    }
    case 'table_update_row': {
      const parsed = parseInternalContractInput(updateTableRowContract, request.input)
      return parsed.success
        ? dispatched(
            updateTableRowContract,
            executeTableUpdateRow(
              parsed.data.params.tableId,
              parsed.data.params.rowId,
              parsed.data.body,
              operationContext
            )
          )
        : parsed.response
    }
    case 'table_update_rows_by_filter': {
      const parsed = parseInternalContractInput(updateTableRowsByFilterContract, request.input)
      return parsed.success
        ? dispatched(
            updateTableRowsByFilterContract,
            executeTableUpdateRowsByFilter(
              parsed.data.params.tableId,
              parsed.data.body,
              operationContext
            )
          )
        : parsed.response
    }
    case 'table_delete_row': {
      const parsed = parseInternalContractInput(deleteTableRowContract, request.input)
      return parsed.success
        ? dispatched(
            deleteTableRowContract,
            executeTableDeleteRow(
              parsed.data.params.tableId,
              parsed.data.params.rowId,
              parsed.data.body,
              operationContext
            )
          )
        : parsed.response
    }
    case 'table_delete_rows_by_filter': {
      const parsed = parseInternalContractInput(deleteTableRowsContract, request.input)
      return parsed.success
        ? dispatched(
            deleteTableRowsContract,
            executeTableDeleteRows(parsed.data.params.tableId, parsed.data.body, operationContext)
          )
        : parsed.response
    }
    case 'table_upsert_row': {
      const parsed = parseInternalContractInput(upsertTableRowContract, request.input)
      return parsed.success
        ? dispatched(
            upsertTableRowContract,
            executeTableUpsertRow(parsed.data.params.tableId, parsed.data.body, operationContext)
          )
        : parsed.response
    }
    case 'table_list_folders': {
      const parsed = parseInternalOperationInput(tableListFoldersSchemas, request.input)
      return parsed.success
        ? dispatchedSchema(
            tableListFoldersResponseSchema,
            executeTableListFolders(parsed.data.body, operationContext)
          )
        : parsed.response
    }
    case 'table_create_folder': {
      const parsed = parseInternalOperationInput(tableCreateFolderSchemas, request.input)
      return parsed.success
        ? dispatchedSchema(
            tableCreateFolderResponseSchema,
            executeTableCreateFolder(parsed.data.body, operationContext)
          )
        : parsed.response
    }
    case 'table_update_folder': {
      const parsed = parseInternalOperationInput(tableUpdateFolderSchemas, request.input)
      return parsed.success
        ? dispatchedSchema(
            tableUpdateFolderResponseSchema,
            executeTableUpdateFolder(parsed.data.body, operationContext)
          )
        : parsed.response
    }
    case 'table_delete_folder': {
      const parsed = parseInternalOperationInput(tableDeleteFolderSchemas, request.input)
      return parsed.success
        ? dispatchedSchema(
            tableDeleteFolderResponseSchema,
            executeTableDeleteFolder(parsed.data.body, operationContext)
          )
        : parsed.response
    }
    case 'table_restore_folder': {
      const parsed = parseInternalOperationInput(tableRestoreFolderSchemas, request.input)
      return parsed.success
        ? dispatchedSchema(
            tableRestoreFolderResponseSchema,
            executeTableRestoreFolder(parsed.data.body, operationContext)
          )
        : parsed.response
    }
    case 'table_move': {
      const parsed = parseInternalOperationInput(tableMoveSchemas, request.input)
      return parsed.success
        ? dispatchedSchema(
            tableMoveResponseSchema,
            executeTableMove(parsed.data.body, operationContext)
          )
        : parsed.response
    }
    default:
      return Response.json({ error: `Unsupported Table tool: ${request.toolId}` }, { status: 500 })
  }
}

export const executeTableTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()

  if (!Object.hasOwn(FAILURE_MESSAGES, request.toolId)) {
    return Response.json({ error: `Unsupported Table tool: ${request.toolId}` }, { status: 500 })
  }

  const scope = resolveScopedTableId(request.toolId, request.input)
  if (!scope.success) return scope.response
  const tableId = scope.tableId
  try {
    const principal = await createExecutorPrincipalFromExecutionContext({
      context: request.context,
      audience: TABLE_DELEGATION_AUDIENCE,
      ...(tableId ? { resourceScope: { tableId } } : {}),
    })
    request.signal?.throwIfAborted()

    const result = await dispatchTableTool(request, {
      principal,
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
    })
    if (result instanceof Response) return result
    const validatedBody = result.responseSchema.parse(result.result.body) as Record<string, unknown>
    return createTableToolResponse(validatedBody, result.result.provenance)
  } catch (error) {
    request.signal?.throwIfAborted()
    const identityFault = classifyInternalToolIdentityFault(error)
    if (identityFault) {
      return Response.json(
        { error: internalToolIdentityFaultMessage(identityFault) },
        { status: internalToolIdentityFaultStatus(identityFault) }
      )
    }
    return errorResponse(
      request.toolId,
      error,
      request.requestId,
      errorPolicyForTool(request.toolId)
    )
  }
}
