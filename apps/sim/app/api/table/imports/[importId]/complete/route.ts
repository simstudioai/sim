import { completeTableImportResourceContract } from '@/lib/api/contracts/table-transfers'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalTableErrorPolicies, internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { completeTableImportUseCase } from '@/lib/table/application/imports'
import { tableOperations } from '@/lib/table/application/operations'
import { toV2TableImport } from '@/lib/table/orchestration/import-resource'

export const POST = defineInternalJsonRoute({
  contract: completeTableImportResourceContract,
  auth: internalTableSessionOrExecutorAuth,
  operation: tableOperations.completeImport,
  rateLimit: internalRateLimits.none({
    reason: 'Existing authenticated table import completion has no request-rate policy',
  }),
  errorPolicy: internalTableErrorPolicies.concealImportAuthorization,
  mapInput: ({ params, query, headers }) => ({
    importId: params.importId,
    workspaceId: query.workspaceId,
    uploadToken: headers['upload-token'],
  }),
  useCase: completeTableImportUseCase,
  present: ({ import: record }) => ({ data: toV2TableImport(record) }),
})
