import { v2BulkDeleteTablesContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { bulkDeleteTables } from '@/lib/table/application/bulk'
import { tableOperations } from '@/lib/table/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Archives a mixed selection of tables and deletes table folders in one
 * authorized request. Archived tables stay recoverable through
 * `POST /tables/{tableId}/restore`; a deleted folder cascades.
 */
export const POST = defineV2JsonRoute({
  contract: v2BulkDeleteTablesContract,
  operation: tableOperations.bulkDelete,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.bulk,
  mapInput: ({ body }) => ({
    assertedWorkspaceId: body.workspaceId,
    folderKeying: 'paths' as const,
    tableIds: body.tableIds,
    folders: body.folderPaths,
  }),
  useCase: bulkDeleteTables,
  present: ({ deleted, skipped, notFound, failed, deletedItems }) => ({
    data: { deleted, skipped, notFound, failed, deletedItems },
  }),
})
