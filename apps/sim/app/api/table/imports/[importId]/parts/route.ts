import { createTableImportPartUrlsContract } from '@/lib/api/contracts/table-transfers'
import {
  defineInternalJsonRoute,
  internalPlainOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createTableImportPartsUseCase } from '@/lib/table/application/imports'
import { tableOperations } from '@/lib/table/application/operations'

export const POST = defineInternalJsonRoute({
  contract: createTableImportPartUrlsContract,
  auth: internalSessionAuth,
  operation: tableOperations.createImportParts,
  rateLimit: internalRateLimits.none({
    reason: 'Existing authenticated table import part signing has no request-rate policy',
  }),
  errorPolicy: internalPlainOrchestrationErrorPolicy,
  mapInput: ({ params, query, headers, body }) => ({
    importId: params.importId,
    workspaceId: query.workspaceId,
    uploadToken: headers['upload-token'],
    partNumbers: body.partNumbers,
  }),
  useCase: createTableImportPartsUseCase,
  present: ({ parts }) => ({ data: { parts } }),
})
