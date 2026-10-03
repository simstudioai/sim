import { createTableExportResourceContract } from '@/lib/api/contracts/table-transfers'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalTableErrorPolicies, internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { createTableExportUseCase } from '@/lib/table/application/exports'
import { tableOperations } from '@/lib/table/application/operations'
import { toV2TableExport } from '@/lib/table/orchestration/export-resource'

export const POST = defineInternalJsonRoute({
  contract: createTableExportResourceContract,
  auth: internalTableSessionOrExecutorAuth,
  operation: tableOperations.createExport,
  rateLimit: internalRateLimits.none({
    reason: 'Existing authenticated table export creation has no request-rate policy',
  }),
  errorPolicy: internalTableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    workspaceId: body.workspaceId,
    format: body.format,
  }),
  useCase: createTableExportUseCase,
  present: ({ export: record }) => ({ data: toV2TableExport(record, true) }),
})
