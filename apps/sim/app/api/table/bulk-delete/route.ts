import { bulkDeleteTablesContract } from '@/lib/api/contracts/tables'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalTableErrorPolicies } from '@/lib/table/api'
import { bulkDeleteTables } from '@/lib/table/application/bulk'
import { tableOperations } from '@/lib/table/application/operations'

export const POST = defineInternalJsonRoute({
  contract: bulkDeleteTablesContract,
  auth: internalSessionAuth,
  operation: tableOperations.bulkDelete,
  rateLimit: internalRateLimits.none({
    reason: 'Matches the unlimited single-table and single-folder deletes it batches',
  }),
  errorPolicy: internalTableErrorPolicies.bulk,
  mapInput: ({ body }) => ({
    assertedWorkspaceId: body.workspaceId,
    folderKeying: 'ids' as const,
    tableIds: body.tableIds,
    folders: body.folderIds,
  }),
  useCase: bulkDeleteTables,
  present: ({ deleted, skipped, notFound, failed, deletedItems }) => ({
    success: true as const,
    data: { deleted, skipped, notFound, failed, deletedItems },
  }),
})
