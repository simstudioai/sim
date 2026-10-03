import { resumeWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalWorkflowErrorPolicies, internalWorkflowReadAuth } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readPausedWorkflowExecution } from '@/lib/workflows/application/read-paused-workflow-execution'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: resumeWorkflowExecutionContract,
  auth: internalWorkflowReadAuth,
  operation: workflowOperations.readPausedExecution,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing authenticated resume-detail behavior',
  }),
  errorPolicy: internalWorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({
    workflowId: params.workflowId,
    executionId: params.executionId,
  }),
  useCase: readPausedWorkflowExecution,
  responseHeaders: () => ({ 'Cache-Control': 'private, no-store' }),
  present: (executionDetail) => ({
    ...executionDetail,
    pausePoints: executionDetail.pausePoints.map((pausePoint) => ({ ...pausePoint })),
    queue: executionDetail.queue.map((queueEntry) => ({ ...queueEntry })),
  }),
})
