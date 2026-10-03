import { v2TableExportDownloadContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { downloadTableExportUseCase } from '@/lib/table/application/exports'
import { tableOperations } from '@/lib/table/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2TableExportDownloadContract,
  operation: tableOperations.downloadExport,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealExportAuthorization,
  mapInput: ({ params, query }) => ({
    tableId: params.tableId,
    exportId: params.exportId,
    workspaceId: query.workspaceId,
  }),
  useCase: downloadTableExportUseCase,
  present: (result) => ({ data: result }),
})
