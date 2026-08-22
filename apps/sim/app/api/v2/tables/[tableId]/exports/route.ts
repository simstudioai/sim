import { v2CreateTableExportContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { createTableExportUseCase } from '@/lib/table/application/exports'
import { tableOperations } from '@/lib/table/application/operations'
import { presentV2TableExport } from '@/app/api/v2/tables/presenters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2CreateTableExportContract,
  operation: tableOperations.createExport,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ params, body }) => ({
    tableId: params.tableId,
    workspaceId: body.workspaceId,
    format: body.format,
  }),
  useCase: createTableExportUseCase,
  present: ({ export: tableExport }) => presentV2TableExport(tableExport, true),
})
