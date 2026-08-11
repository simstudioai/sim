import {
  v2CancelTableExportContract,
  v2GetTableExportContract,
} from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { cancelTableExportUseCase, readTableExportUseCase } from '@/lib/table/application/exports'
import { tableOperations } from '@/lib/table/application/operations'
import { presentV2TableExport } from '@/app/api/v2/tables/presenters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2GetTableExportContract,
  operation: tableOperations.readExport,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealExportAuthorization,
  mapInput: ({ params, query }) => ({
    exportId: params.exportId,
    workspaceId: query.workspaceId,
  }),
  useCase: readTableExportUseCase,
  present: ({ export: tableExport }) => presentV2TableExport(tableExport),
})

export const DELETE = defineV2JsonRoute({
  contract: v2CancelTableExportContract,
  operation: tableOperations.cancelExport,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealExportAuthorization,
  mapInput: ({ params, query }) => ({
    exportId: params.exportId,
    workspaceId: query.workspaceId,
  }),
  useCase: cancelTableExportUseCase,
  present: ({ export: tableExport }) => presentV2TableExport(tableExport),
})
