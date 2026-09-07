import { readClientId } from '@/lib/api/client-id'
import {
  batchUpdateTableRowsContract,
  deleteTableRowsContract,
  insertTableRowsContract,
  listTableRowsContract,
  updateTableRowsByFilterContract,
} from '@/lib/api/contracts/tables'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalRateLimits,
  resolveInternalAuthWorkspaceId,
} from '@/lib/api/server/routes'
import type { Filter, RowData, Sort, SortSpec, TablePredicate } from '@/lib/table'
import { internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { internalTableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import {
  batchUpdateTableRows,
  createTableRows,
  deleteTableRows,
  queryTableRows,
  updateTableRows,
} from '@/lib/table/application/rows'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { isTablePredicate } from '@/lib/table/query-builder/converters'
import {
  finalizeTableRowsProvenance,
  negotiateTableRowsProvenance,
  readTableRowProvenanceEnvelope,
} from '@/app/api/table/row-secret-provenance'
import { presentQueryRowForKeying, rowKeyingForAuthTransport } from '@/app/api/table/row-wire'

const rateLimit = internalRateLimits.none({
  reason: 'Preserve existing internal table rows behavior',
})

function rowErrorPolicy(fallback: string) {
  return {
    ...internalTableRowsErrorPolicy,
    unhandled: () => internalErrorResponse(500, { error: fallback }),
  }
}

export const POST = defineInternalJsonRoute({
  contract: insertTableRowsContract,
  operation: tableOperations.createRows,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: rowErrorPolicy('Failed to insert row'),
  mapInput: ({ params, body }, { request, authTransport, executionWorkspaceId }) => {
    const rowKeying = rowKeyingForAuthTransport(authTransport)
    const shared = {
      tableId: params.tableId,
      assertedWorkspaceId: resolveInternalAuthWorkspaceId(
        authTransport,
        executionWorkspaceId,
        body.workspaceId
      ),
      strictWrite: false,
      dataKeying: rowKeying,
      secretProvenanceEnvelope: readTableRowProvenanceEnvelope(request, body),
      includePersistedSecretProvenance: negotiateTableRowsProvenance(
        request,
        authTransport === 'executor_jwt'
      ),
    }
    return 'rows' in body
      ? {
          ...shared,
          kind: 'batch' as const,
          rows: body.rows as RowData[],
          orderKeys: body.orderKeys,
        }
      : {
          ...shared,
          kind: 'single' as const,
          data: body.data as RowData,
          position: body.position,
          afterRowId: body.afterRowId,
          beforeRowId: body.beforeRowId,
          actorClientId: readClientId(request),
        }
  },
  useCase: createTableRows,
  present: (result, { authTransport }) => {
    const rowKeying = rowKeyingForAuthTransport(authTransport)
    return result.kind === 'single'
      ? {
          success: true as const,
          data: {
            row: presentQueryRowForKeying(result.row, result.table.schema, rowKeying),
            message: 'Row inserted successfully',
          },
        }
      : {
          success: true as const,
          data: {
            rows: result.rows.map((row) =>
              presentQueryRowForKeying(row, result.table.schema, rowKeying)
            ),
            insertedCount: result.rows.length,
            message: `Successfully inserted ${result.rows.length} rows`,
          },
        }
  },
  finalizeResponse: ({ result }) => finalizeTableRowsProvenance(result.secretProvenance),
})

export const GET = defineInternalJsonRoute({
  contract: listTableRowsContract,
  operation: tableOperations.queryRows,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: rowErrorPolicy('Failed to query rows'),
  mapInput: ({ params, query }, { request, authTransport, executionWorkspaceId }) => {
    const filter = query.filter as Filter | TablePredicate | undefined
    const sort = query.sort as Sort | SortSpec | undefined
    return {
      tableId: params.tableId,
      assertedWorkspaceId: resolveInternalAuthWorkspaceId(
        authTransport,
        executionWorkspaceId,
        query.workspaceId
      ),
      ...(filter && isTablePredicate(filter)
        ? { predicate: filter }
        : { legacyFilter: filter as Filter | undefined }),
      ...(Array.isArray(sort)
        ? { sort: sort as SortSpec }
        : { legacySort: sort as Sort | undefined }),
      legacyKeying: rowKeyingForAuthTransport(authTransport),
      limit: query.limit,
      offset: query.offset,
      after: query.after,
      includeTotal: query.includeTotal,
      includeRunState: query.limit !== undefined && query.limit <= TABLE_LIMITS.MAX_QUERY_LIMIT,
      allowExpandedLimit: true,
      includePersistedSecretProvenance: negotiateTableRowsProvenance(
        request,
        authTransport === 'executor_jwt'
      ),
    }
  },
  useCase: queryTableRows,
  present: (result, { authTransport }) => ({
    success: true as const,
    data: {
      rows: result.rows.map((row) =>
        presentQueryRowForKeying(row, result.table.schema, rowKeyingForAuthTransport(authTransport))
      ),
      rowCount: result.rowCount,
      totalCount: result.totalCount,
      limit: result.limit,
      offset: result.offset,
      nextCursor: result.nextCursor,
    },
  }),
  finalizeResponse: ({ result }) => finalizeTableRowsProvenance(result.secretProvenance),
})

export const PUT = defineInternalJsonRoute({
  contract: updateTableRowsByFilterContract,
  operation: tableOperations.updateRows,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: rowErrorPolicy('Failed to update rows'),
  mapInput: ({ params, body }, { request, authTransport, executionWorkspaceId }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: resolveInternalAuthWorkspaceId(
      authTransport,
      executionWorkspaceId,
      body.workspaceId
    ),
    filter: body.filter,
    filterKeying: rowKeyingForAuthTransport(authTransport),
    data: body.data as RowData,
    dataKeying: rowKeyingForAuthTransport(authTransport),
    strictWrite: false,
    limit: body.limit,
    secretProvenanceEnvelope: readTableRowProvenanceEnvelope(request, body),
  }),
  useCase: updateTableRows,
  present: ({ affectedCount, affectedRowIds }) => ({
    success: true as const,
    data: {
      message:
        affectedCount === 0 ? 'No rows matched the filter criteria' : 'Rows updated successfully',
      updatedCount: affectedCount,
      ...(affectedCount > 0 ? { updatedRowIds: affectedRowIds } : {}),
    },
  }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteTableRowsContract,
  operation: tableOperations.deleteRows,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: rowErrorPolicy('Failed to delete rows'),
  mapInput: ({ params, body }, { authTransport, executionWorkspaceId }) =>
    body.rowIds
      ? {
          kind: 'ids' as const,
          tableId: params.tableId,
          assertedWorkspaceId: resolveInternalAuthWorkspaceId(
            authTransport,
            executionWorkspaceId,
            body.workspaceId
          ),
          rowIds: body.rowIds,
        }
      : {
          kind: 'filter' as const,
          tableId: params.tableId,
          assertedWorkspaceId: resolveInternalAuthWorkspaceId(
            authTransport,
            executionWorkspaceId,
            body.workspaceId
          ),
          filter: body.filter!,
          filterKeying: rowKeyingForAuthTransport(authTransport),
          limit: body.limit,
        },
  useCase: deleteTableRows,
  present: (result) =>
    result.kind === 'ids'
      ? {
          success: true as const,
          data: {
            message:
              result.deletedCount === 0
                ? 'No matching rows found for the provided IDs'
                : 'Rows deleted successfully',
            deletedCount: result.deletedCount,
            deletedRowIds: result.deletedRowIds,
            requestedCount: result.requestedCount,
            ...(result.missingRowIds.length > 0 ? { missingRowIds: result.missingRowIds } : {}),
          },
        }
      : {
          success: true as const,
          data: {
            message:
              result.affectedCount === 0
                ? 'No rows matched the filter criteria'
                : 'Rows deleted successfully',
            deletedCount: result.affectedCount,
            deletedRowIds: result.affectedRowIds,
          },
        },
})

export const PATCH = defineInternalJsonRoute({
  contract: batchUpdateTableRowsContract,
  operation: tableOperations.updateRows,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: rowErrorPolicy('Failed to update rows'),
  mapInput: ({ params, body }, { request, authTransport, executionWorkspaceId }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: resolveInternalAuthWorkspaceId(
      authTransport,
      executionWorkspaceId,
      body.workspaceId
    ),
    strictWrite: false,
    dataKeying: rowKeyingForAuthTransport(authTransport),
    updates: body.updates.map((update) => ({
      rowId: update.rowId,
      data: update.data as RowData,
    })),
    secretProvenanceEnvelope: readTableRowProvenanceEnvelope(request, body),
  }),
  useCase: batchUpdateTableRows,
  present: ({ affectedCount, affectedRowIds }) => ({
    success: true as const,
    data: {
      message: 'Rows updated successfully',
      updatedCount: affectedCount,
      updatedRowIds: affectedRowIds,
    },
  }),
})
