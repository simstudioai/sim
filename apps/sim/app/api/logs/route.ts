import { listLogsContract } from '@/lib/api/contracts/logs'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { internalLogsSessionOrExecutorAuth } from '@/lib/logs/api/route-policies'
import { listLogsUseCase } from '@/lib/logs/application/list-logs'
import { logOperations } from '@/lib/logs/application/operations'

const errorPolicy = {
  ...internalOrchestrationErrorPolicy,
  unhandled: () => internalErrorResponse(500, { error: 'Failed to list logs' }),
}

export const GET = defineInternalJsonRoute({
  contract: listLogsContract,
  auth: internalLogsSessionOrExecutorAuth,
  operation: logOperations.list,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal logs list behavior' }),
  errorPolicy,
  mapInput: ({ query }, { principal, request }) => ({
    ...query,
    workspaceId: principal.kind === 'delegated' ? principal.workspaceId : query.workspaceId,
    signal: request.signal,
  }),
  useCase: listLogsUseCase,
  present: (result) => result,
})
