import { createTableImportResourceContract } from '@/lib/api/contracts/table-transfers'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalTableErrorPolicies, internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { createTableImportUseCase } from '@/lib/table/application/imports'
import { tableOperations } from '@/lib/table/application/operations'
import { toV2CreateTableImport } from '@/lib/table/orchestration/import-resource'

export const POST = defineInternalJsonRoute({
  contract: createTableImportResourceContract,
  auth: internalTableSessionOrExecutorAuth,
  operation: tableOperations.createImport,
  rateLimit: internalRateLimits.none({
    reason: 'Existing authenticated table import creation has no request-rate policy',
  }),
  errorPolicy: internalTableErrorPolicies.concealTableAuthorization,
  mapInput: ({ body }) => ({ body }),
  useCase: createTableImportUseCase,
  present: ({ import: created }) => ({ data: toV2CreateTableImport(created) }),
})
