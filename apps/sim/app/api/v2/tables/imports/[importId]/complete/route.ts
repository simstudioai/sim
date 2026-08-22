import { v2CompleteTableImportContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { completeTableImportUseCase } from '@/lib/table/application/imports'
import { tableOperations } from '@/lib/table/application/operations'
import { presentV2TableImport } from '@/app/api/v2/tables/presenters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2CompleteTableImportContract,
  operation: tableOperations.completeImport,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealImportAuthorization,
  mapInput: ({ params, query, headers }) => ({
    importId: params.importId,
    workspaceId: query.workspaceId,
    uploadToken: headers['upload-token'],
  }),
  useCase: completeTableImportUseCase,
  present: ({ import: tableImport }) => presentV2TableImport(tableImport),
})
