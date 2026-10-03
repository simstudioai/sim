import { bulkMoveTablesContract } from '@/lib/api/contracts/tables'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalTableErrorPolicies } from '@/lib/table/api'
import { bulkMoveTables } from '@/lib/table/application/bulk'
import { tableOperations } from '@/lib/table/application/operations'

export const POST = defineInternalJsonRoute({
  contract: bulkMoveTablesContract,
  auth: internalSessionAuth,
  operation: tableOperations.bulkMove,
  rateLimit: internalRateLimits.none({
    reason: 'Matches the unlimited single-table and single-folder moves it batches',
  }),
  errorPolicy: internalTableErrorPolicies.bulk,
  mapInput: ({ body }) => ({
    assertedWorkspaceId: body.workspaceId,
    folderKeying: 'ids' as const,
    tableIds: body.tableIds,
    folders: body.folderIds,
    targetFolder: body.targetFolderId,
  }),
  useCase: bulkMoveTables,
  present: ({ moved, skipped, notFound, failed }) => ({
    success: true as const,
    data: { moved, skipped, notFound, failed },
  }),
})
