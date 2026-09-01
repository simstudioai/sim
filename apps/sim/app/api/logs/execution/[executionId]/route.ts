import { getExecutionSnapshotContract } from '@/lib/api/contracts/logs'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { internalLogsSessionOrExecutorAuth } from '@/lib/logs/api/route-policies'
import { logOperations } from '@/lib/logs/application/operations'
import { readExecutionSnapshotUseCase } from '@/lib/logs/application/read-execution-snapshot'

const errorPolicy = {
  ...internalOrchestrationErrorPolicy,
  unhandled: () => internalErrorResponse(500, { error: 'Failed to fetch execution data' }),
}

export const GET = defineInternalJsonRoute({
  contract: getExecutionSnapshotContract,
  auth: internalLogsSessionOrExecutorAuth,
  operation: logOperations.readExecutionSnapshot,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing execution snapshot behavior' }),
  errorPolicy,
  mapInput: ({ params }, { request }) => ({
    executionId: params.executionId,
    signal: request.signal,
  }),
  useCase: readExecutionSnapshotUseCase,
  present: (result) => result,
})
