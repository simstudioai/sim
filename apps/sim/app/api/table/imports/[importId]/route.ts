import {
  cancelTableImportResourceContract,
  getTableImportResourceContract,
} from '@/lib/api/contracts/table-transfers'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalTableErrorPolicies, internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { cancelTableImportUseCase, readTableImportUseCase } from '@/lib/table/application/imports'
import { tableOperations } from '@/lib/table/application/operations'
import { toV2TableImport } from '@/lib/table/orchestration/import-resource'

const rateLimit = internalRateLimits.none({
  reason: 'Existing authenticated table import resource access has no request-rate policy',
})

export const GET = defineInternalJsonRoute({
  contract: getTableImportResourceContract,
  auth: internalTableSessionOrExecutorAuth,
  operation: tableOperations.readImport,
  rateLimit,
  errorPolicy: internalTableErrorPolicies.concealImportAuthorization,
  mapInput: ({ params, query }) => ({
    importId: params.importId,
    workspaceId: query.workspaceId,
  }),
  useCase: readTableImportUseCase,
  present: ({ import: record }) => ({ data: toV2TableImport(record) }),
})

export const DELETE = defineInternalJsonRoute({
  contract: cancelTableImportResourceContract,
  auth: internalTableSessionOrExecutorAuth,
  operation: tableOperations.cancelImport,
  rateLimit,
  errorPolicy: internalTableErrorPolicies.concealImportAuthorization,
  mapInput: ({ params, query, headers }) => ({
    importId: params.importId,
    workspaceId: query.workspaceId,
    uploadToken: headers['upload-token'],
  }),
  useCase: cancelTableImportUseCase,
  present: ({ import: record }) => ({ data: toV2TableImport(record) }),
})
