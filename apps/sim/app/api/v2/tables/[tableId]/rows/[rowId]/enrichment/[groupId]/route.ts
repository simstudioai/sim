import { v2RunRowEnrichmentContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { startTableRun } from '@/lib/table/application/runs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2RunRowEnrichmentContract,
  operation: tableOperations.startRun,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableRowsErrorPolicy,
  mapInput: ({ params, body }) => ({
    kind: 'row_enrichment' as const,
    tableId: params.tableId,
    rowId: params.rowId,
    groupId: params.groupId,
    assertedWorkspaceId: body.workspaceId,
  }),
  useCase: startTableRun,
  present: ({ dispatchId }) => ({ data: { dispatchId } }),
})
