import { v2CancelWorkflowRunContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
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
  errorPolicy: v2WorkflowErrorPolicies.concealRunAuthorization,
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
  /**
   * Reports a cancellation, so it needs the run to have actually been
   * cancelled. `success` alone no longer implies that: a cancel against an
   * already-terminal run satisfies the request without writing anything, and
   * reports `success: true` with `durablyRecorded: false`. Requiring both also
   * keeps the event off a cancellation that reached the row but failed its
   * paused reconciliation, which reports the inverse pair.
   */
  onSuccess: ({ principal, result }) => {
    if (!result.success || !result.durablyRecorded || principal.kind !== 'personal_api_key') return
    captureServerEvent(
      principal.userId,
      'workflow_execution_cancelled',
      { workflow_id: result.workflowId, workspace_id: result.workspaceId },
      { groups: { workspace: result.workspaceId } }
    )
  },
})
