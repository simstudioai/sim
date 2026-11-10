import { getTableImportResourceContract } from '@/lib/api/contracts/table-transfers'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalTableErrorPolicies, internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { readTableImportUseCase } from '@/lib/table/application/imports'
import { tableOperations } from '@/lib/table/application/operations'
import { toV2TableImport } from '@/lib/table/orchestration/import-resource'

export const GET = defineInternalJsonRoute({
  contract: getTableImportResourceContract,
  auth: internalTableSessionOrExecutorAuth,
  operation: tableOperations.readImport,
  rateLimit: internalRateLimits.none({
    reason: 'Existing authenticated table import resource access has no request-rate policy',
  }),
  errorPolicy: internalTableErrorPolicies.concealImportAuthorization,
  mapInput: ({ params, query }) => ({
    importId: params.importId,
    workspaceId: query.workspaceId,
  }),
  useCase: readTableImportUseCase,
  present: ({ import: record }) => ({ data: toV2TableImport(record) }),
})
