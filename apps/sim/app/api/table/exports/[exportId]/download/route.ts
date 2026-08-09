import { downloadTableExportResourceContract } from '@/lib/api/contracts/table-transfers'
import {
  defineInternalJsonRoute,
  internalPlainOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { downloadTableExportUseCase } from '@/lib/table/application/exports'
import { tableOperations } from '@/lib/table/application/operations'

export const GET = defineInternalJsonRoute({
  contract: downloadTableExportResourceContract,
  auth: internalSessionAuth,
  operation: tableOperations.downloadExport,
  rateLimit: internalRateLimits.none({
    reason: 'Existing authenticated table export download signing has no request-rate policy',
  }),
  errorPolicy: internalPlainOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    exportId: params.exportId,
    workspaceId: query.workspaceId,
  }),
  useCase: downloadTableExportUseCase,
  present: (result) => ({ data: result }),
})
