import { v2RestoreTableContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { tableOperations } from '@/lib/table/application/operations'
import { restoreTableUseCase } from '@/lib/table/application/tables'
import { toApiTable } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Un-archives a table `DELETE /tables/{tableId}` archived, with the rows,
 * views, and groups archived alongside it. Without this a headless delete was
 * unrecoverable: `scope=archived` on the list can find the table, but nothing
 * could bring it back.
 */
export const POST = defineV2JsonRoute({
  contract: v2RestoreTableContract,
  operation: tableOperations.restore,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    workspaceId: body.workspaceId,
  }),
  useCase: restoreTableUseCase,
  present: async ({ table, folderPath }) => ({ data: await toApiTable(table, folderPath) }),
})
