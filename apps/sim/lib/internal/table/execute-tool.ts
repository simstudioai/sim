import { createLogger } from '@sim/logger'
import type { AnyApiRouteContract } from '@/lib/api/contracts'
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
import { type InternalErrorPolicy, internalOrchestrationErrorPolicy } from '@/lib/api/server/routes'
import {
  createExecutorPrincipalFromExecutionContext,
  requireExecutorWorkspaceId,
} from '@/lib/internal/principals/executor'
import {
  executeTableCreate,
  executeTableDeleteRow,
  executeTableDeleteRows,
  executeTableGetRow,
  executeTableGetSchema,
  executeTableInsertRows,
  executeTableList,
  executeTableQueryRows,
  executeTableQueryRowsV2,
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
import { parseInternalContractInput } from '@/lib/internal/tool-operations/parse-contract-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { internalTableErrorPolicies } from '@/lib/table/api/route-policies'
import {
  internalTableRowsErrorPolicy,
  internalTableV2QueryErrorPolicy,
} from '@/lib/table/api/row-route-policies'

const logger = createLogger('TableInternalOperation')

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

async function dispatchTableTool(
  request: Parameters<InternalToolOperationHandler>[0],
  operationContext: TableToolOperationContext
): Promise<{ contract: AnyApiRouteContract; result: TableToolOperationResult } | Response> {
  const dispatched = async (
    contract: AnyApiRouteContract,
    result: Promise<TableToolOperationResult>
  ) => ({ contract, result: await result })

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
    default:
      return Response.json({ error: `Unsupported Table tool: ${request.toolId}` }, { status: 500 })
  }
}

export const executeTableTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()

  if (!Object.hasOwn(FAILURE_MESSAGES, request.toolId)) {
    return Response.json({ error: `Unsupported Table tool: ${request.toolId}` }, { status: 500 })
  }

  const scopedInput = TABLE_SCOPED_TOOLS.has(request.toolId)
    ? parseInternalContractInput(getTableContract, request.input)
    : undefined
  if (scopedInput && !scopedInput.success) return scopedInput.response
  const tableId = scopedInput?.data.params.tableId
  try {
    const principal = await createExecutorPrincipalFromExecutionContext({
      context: request.context,
    })
    request.signal?.throwIfAborted()

    const result = await dispatchTableTool(request, {
      principal,
      workspaceId: requireExecutorWorkspaceId(request.context),
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
    })
    if (result instanceof Response) return result
    if (result.contract.response.mode !== 'json') {
      throw new Error('Table tool contract must return JSON')
    }
    const validatedBody = result.contract.response.schema.parse(result.result.body) as Record<
      string,
      unknown
    >
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
