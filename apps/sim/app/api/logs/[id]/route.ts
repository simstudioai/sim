import { getLogDetailContract } from '@/lib/api/contracts/logs'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  resolveInternalAuthWorkspaceId,
} from '@/lib/api/server/routes'
import { internalLogsSessionOrExecutorAuth } from '@/lib/logs/api/route-policies'
import { logOperations } from '@/lib/logs/application/operations'
import { readLogDetailUseCase } from '@/lib/logs/application/read-log-detail'

const errorPolicy = {
  ...internalOrchestrationErrorPolicy,
  unhandled: () => internalErrorResponse(500, { error: 'Failed to fetch log' }),
}

export const GET = defineInternalJsonRoute({
  contract: getLogDetailContract,
  auth: internalLogsSessionOrExecutorAuth,
  operation: logOperations.readDetail,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal log detail behavior' }),
  errorPolicy,
  mapInput: ({ params, query }, { request, authTransport, executionWorkspaceId }) => ({
    workspaceId: resolveInternalAuthWorkspaceId(
      authTransport,
      executionWorkspaceId,
      query.workspaceId
    ),
    lookupColumn: 'id' as const,
    lookupValue: params.id,
    signal: request.signal,
  }),
  useCase: readLogDetailUseCase,
  present: ({ detail }) => ({ data: detail }),
})
