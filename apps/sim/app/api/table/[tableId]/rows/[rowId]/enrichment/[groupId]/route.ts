import { getEnrichmentDetailContract } from '@/lib/api/contracts/tables'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { internalTableRowsErrorPolicy } from '@/lib/table/api/row-route-policies'
import { tableOperations } from '@/lib/table/application/operations'
import { readTableRowEnrichmentDetail } from '@/lib/table/application/rows'

export const dynamic = 'force-dynamic'

/**
 * GET /api/table/[tableId]/rows/[rowId]/enrichment/[groupId]
 *
 * The enrichment cascade breakdown — provider outcomes, cost, timing — for one
 * enrichment cell. Read on demand by the details panel; this data is
 * deliberately kept off the hot grid read.
 */
export const GET = defineInternalJsonRoute({
  contract: getEnrichmentDetailContract,
  operation: tableOperations.readRow,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal enrichment-detail behavior',
  }),
  errorPolicy: internalTableRowsErrorPolicy,
  mapInput: ({ params }) => ({
    tableId: params.tableId,
    rowId: params.rowId,
    groupId: params.groupId,
  }),
  useCase: readTableRowEnrichmentDetail,
  present: ({ detail }) => ({ success: true as const, data: { detail } }),
})
