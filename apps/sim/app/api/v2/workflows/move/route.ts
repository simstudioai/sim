import { v2MoveWorkflowsContract } from '@/lib/api/contracts/v2/workflows'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { moveWorkflowsBulk } from '@/lib/workflows/application/move-workflows-bulk'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Relocates up to 100 workflows into one folder.
 *
 * Explicitly best-effort: each workflow moves in its own transaction, and one
 * that is absent from the workspace, archived, or locked lands in `failed` while
 * the rest still move. An infrastructure fault is propagated rather than
 * reported as a per-item failure.
 *
 * Sits beside `/workflows/folders` at the collection level so it cannot shadow
 * `/workflows/{workflowId}`.
 */
export const POST = defineV2JsonRoute({
  contract: v2MoveWorkflowsContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.moveBulk,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    workflowIds: body.workflowIds,
    folderPath: body.folderPath,
  }),
  useCase: moveWorkflowsBulk,
  present: (result, { body }) => ({
    data: { moved: result.moved, failed: result.failed, folderPath: body.folderPath },
  }),
})
