import { cancelWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import {
  internalWorkflowErrorPolicies,
  internalWorkflowSessionOrApiKeyAuth,
} from '@/lib/workflows/api'
import { cancelWorkflowRun } from '@/lib/workflows/application/cancel-run'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = defineInternalJsonRoute({
  contract: cancelWorkflowExecutionContract,
  auth: internalWorkflowSessionOrApiKeyAuth,
  operation: workflowOperations.cancelRun,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal cancellation behavior',
  }),
  errorPolicy: internalWorkflowErrorPolicies.concealRunAuthorization,
  mapInput: ({ params }, { request }) => ({
    runId: params.executionId,
    abortSignal: request.signal,
  }),
  useCase: cancelWorkflowRun,
  present: (result) => ({
    success: result.success,
    executionId: result.executionId,
    redisAvailable: result.redisAvailable,
    durablyRecorded: result.durablyRecorded,
    locallyAborted: result.locallyAborted,
    pausedCancelled: result.pausedCancelled,
    reason: result.reason,
  }),
})
