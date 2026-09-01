import { v2CreateTableImportPartUrlsContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { createTableImportPartsUseCase } from '@/lib/table/application/imports'
import { tableOperations } from '@/lib/table/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2CreateTableImportPartUrlsContract,
  operation: tableOperations.createImportParts,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealImportAuthorization,
  mapInput: ({ params, query, headers, body }) => ({
    importId: params.importId,
    workspaceId: query.workspaceId,
    uploadToken: headers['upload-token'],
    partNumbers: body.partNumbers,
  }),
  useCase: createTableImportPartsUseCase,
  present: (result) => ({ data: result }),
})
