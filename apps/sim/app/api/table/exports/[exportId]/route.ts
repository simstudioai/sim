import {
  cancelTableExportResourceContract,
  getTableExportResourceContract,
} from '@/lib/api/contracts/table-transfers'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalTableErrorPolicies, internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { cancelTableExportUseCase, readTableExportUseCase } from '@/lib/table/application/exports'
import { tableOperations } from '@/lib/table/application/operations'
import { toV2TableExport } from '@/lib/table/orchestration/export-resource'

const rateLimit = internalRateLimits.none({
  reason: 'Existing authenticated table export resource access has no request-rate policy',
})

export const GET = defineInternalJsonRoute({
  contract: getTableExportResourceContract,
  auth: internalTableSessionOrExecutorAuth,
  operation: tableOperations.readExport,
  rateLimit,
  errorPolicy: internalTableErrorPolicies.concealExportAuthorization,
  mapInput: ({ params, query }) => ({
    exportId: params.exportId,
    workspaceId: query.workspaceId,
  }),
  useCase: readTableExportUseCase,
  present: ({ export: record }) => ({ data: toV2TableExport(record) }),
})

export const DELETE = defineInternalJsonRoute({
  contract: cancelTableExportResourceContract,
  auth: internalTableSessionOrExecutorAuth,
  operation: tableOperations.cancelExport,
  rateLimit,
  errorPolicy: internalTableErrorPolicies.concealExportAuthorization,
  mapInput: ({ params, query }) => ({
    exportId: params.exportId,
    workspaceId: query.workspaceId,
  }),
  useCase: cancelTableExportUseCase,
  present: ({ export: record }) => ({ data: toV2TableExport(record) }),
})
