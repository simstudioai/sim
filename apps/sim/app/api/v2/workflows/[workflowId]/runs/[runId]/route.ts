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
 * GET /api/v2/workflows/[workflowId]/runs/[runId] — the single status URL
 * for both sync and async runs. When no log row exists yet, the async job
 * queue is consulted (deterministic job id) so a freshly-queued run reports
 * `queued` instead of 404.
 *
 * `headSafe: false` because `includeFileBase64` makes this read pull bytes out
 * of object storage. A bodiless `HEAD` loses nothing here — the whole point of
 * the request is the body.
 */
export const GET = defineV2JsonRoute({
  headSafe: false,
  contract: v2GetWorkflowRunContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.readRun,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealRunAuthorization,
  mapInput: ({ params, query }) => ({
    workflowId: params.workflowId,
    runId: params.runId,
    includeOutput: query.includeOutput,
    selectedOutputs: query.selectedOutputs,
    includeFileBase64: query.includeFileBase64,
    base64MaxBytes: query.base64MaxBytes,
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
      files: status.files,
    },
  }),
})
