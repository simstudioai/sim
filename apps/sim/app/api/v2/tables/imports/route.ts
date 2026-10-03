import { v2CreateTableImportContract } from '@/lib/api/contracts/v2/tables'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api'
import { createTableImportUseCase } from '@/lib/table/application/imports'
import { tableOperations } from '@/lib/table/application/operations'
import { presentV2CreateTableImport } from '@/app/api/v2/tables/presenters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2CreateTableImportContract,
  operation: tableOperations.createImport,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2TableErrorPolicies.concealTableAuthorization,
  mapInput: ({ body }) => ({ body }),
  useCase: createTableImportUseCase,
  present: ({ import: tableImport }) => presentV2CreateTableImport(tableImport),
})
