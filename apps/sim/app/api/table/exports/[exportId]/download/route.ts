import { downloadTableExportResourceContract } from '@/lib/api/contracts/table-transfers'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalTableErrorPolicies, internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { downloadTableExportUseCase } from '@/lib/table/application/exports'
import { tableOperations } from '@/lib/table/application/operations'

export const GET = defineInternalJsonRoute({
  contract: downloadTableExportResourceContract,
  auth: internalTableSessionOrExecutorAuth,
  operation: tableOperations.downloadExport,
  rateLimit: internalRateLimits.none({
    reason: 'Existing authenticated table export download signing has no request-rate policy',
  }),
  errorPolicy: internalTableErrorPolicies.concealExportAuthorization,
  mapInput: ({ params, query }) => ({
    exportId: params.exportId,
    workspaceId: query.workspaceId,
  }),
  useCase: downloadTableExportUseCase,
  present: (result) => ({ data: result }),
})
