import { v2MoveTablesContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { bulkMoveTables } from '@/lib/table/application/bulk'
import { tableOperations } from '@/lib/table/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Moves a mixed selection of tables and table folders in one authorized
 * request. Folders travel by canonical path, as everywhere else on v2; the
 * path-to-folder lookup is authorization-sensitive and happens inside the use
 * case, never here.
 */
export const POST = defineV2JsonRoute({
  contract: v2MoveTablesContract,
  operation: tableOperations.bulkMove,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.bulk,
  mapInput: ({ body }) => ({
    assertedWorkspaceId: body.workspaceId,
    folderKeying: 'paths' as const,
    tableIds: body.tableIds,
    folders: body.folderPaths,
    // The use case requires an explicit choice; omission is the root.
    targetFolder: body.targetFolderPath ?? null,
  }),
  useCase: bulkMoveTables,
  present: ({ moved, skipped, notFound, failed }) => ({
    data: { moved, skipped, notFound, failed },
  }),
})
