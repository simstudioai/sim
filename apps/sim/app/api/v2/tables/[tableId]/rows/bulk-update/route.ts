import { TABLE_QUERY_MAX_BODY_BYTES } from '@/lib/api/contracts/tables'
import { v2BulkUpdateTableRowsContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { batchUpdateTableRows } from '@/lib/table/application/rows'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * One distinct patch per row, in one request. The sibling
 * `PATCH /tables/{tableId}/rows` applies one patch to everything a predicate
 * matches, so N different writes are N calls through it.
 *
 * An explicit body ceiling because a full bulk update is up to a thousand rows of
 * arbitrary cell data; past it the caller gets a 413 rather than the 50 MB
 * default every JSON body is otherwise held to.
 */
export const POST = defineV2JsonRoute({
  contract: v2BulkUpdateTableRowsContract,
  operation: tableOperations.updateRows,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  parseOptions: { maxBodyBytes: TABLE_QUERY_MAX_BODY_BYTES },
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    assertedWorkspaceId: body.workspaceId,
    updates: body.updates,
    strictWrite: true,
    dataKeying: 'names' as const,
  }),
  useCase: batchUpdateTableRows,
  present: ({ affectedCount, affectedRowIds }) => ({
    data: { updatedCount: affectedCount, updatedRowIds: affectedRowIds },
  }),
})
