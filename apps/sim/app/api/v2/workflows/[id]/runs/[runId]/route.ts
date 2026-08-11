import {
  v2GetWorkflowRunContract,
  v2WorkflowRunStatusSchema,
} from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readWorkflowRun } from '@/lib/workflows/application/read-workflow-run'
import { classifyExecutionError } from '@/executor/utils/errors'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v2/workflows/[id]/runs/[runId] — the single status URL
 * for both sync and async runs. When no log row exists yet, the async job
 * queue is consulted (deterministic job id) so a freshly-queued run reports
 * `queued` instead of 404.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowRunContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.readRun,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealRunAuthorization,
  mapInput: ({ params, query }) => ({
    workflowId: params.id,
    runId: params.runId,
    includeOutput: query.includeOutput,
    selectedOutputs: query.selectedOutputs,
  }),
  useCase: readWorkflowRun,
  present: (status) => ({
    data: {
      runId: status.executionId,
      workflowId: status.workflowId,
      status: status.status,
      trigger: status.trigger ?? null,
      startedAt: status.startedAt,
      endedAt: status.endedAt,
      durationMs: status.totalDurationMs,
      paused: status.paused ? v2WorkflowRunStatusSchema.shape.paused.parse(status.paused) : null,
      cost: status.cost,
      error: status.error ? classifyExecutionError(new Error(status.error)) : null,
      output: status.finalOutput,
      blockOutputs: status.blockOutputs,
    },
  }),
})
