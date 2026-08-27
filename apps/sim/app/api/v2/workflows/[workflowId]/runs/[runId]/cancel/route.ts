import { v2CancelWorkflowRunContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { cancelWorkflowRun } from '@/lib/workflows/application/cancel-run'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = defineV2JsonRoute({
  contract: v2CancelWorkflowRunContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.cancelRun,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.cancelRun,
  mapInput: ({ params }) => ({ workflowId: params.workflowId, runId: params.runId }),
  useCase: cancelWorkflowRun,
  present: (result) => ({
    data: {
      success: result.success,
      runId: result.executionId,
      redisAvailable: result.redisAvailable,
      durablyRecorded: result.durablyRecorded,
      locallyAborted: result.locallyAborted,
      pausedCancelled: result.pausedCancelled,
      reason: result.reason,
    },
  }),
})
