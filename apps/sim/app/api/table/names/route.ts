import { listTableNamesContract } from '@/lib/api/contracts/tables'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { tableOperations } from '@/lib/table/application/operations'
import { listTableNamesUseCase } from '@/lib/table/application/tables'

export const POST = defineInternalJsonRoute({
  contract: listTableNamesContract,
  operation: tableOperations.list,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal table list behavior',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: listTableNamesUseCase,
  present: ({ tables }) => ({ success: true as const, data: { tables } }),
})
