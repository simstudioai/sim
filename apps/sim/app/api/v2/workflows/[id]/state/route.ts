import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import {
  v2GetWorkflowStateContract,
  v2ReplaceWorkflowStateContract,
} from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readWorkflowGraph } from '@/lib/workflows/application/read-workflow-graph'
import { replaceWorkflowState } from '@/lib/workflows/application/replace-workflow-state'
import { MAX_IMPORT_BODY_BYTES } from '@/lib/workflows/operations/import-workflow'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Head-safe for the same reason `GET /api/v2/workflows/{id}` is: the only write
 * this read can trigger is migrate-on-read inside
 * `loadWorkflowFromNormalizedTables`, which is conditional, idempotent, and
 * convergent — a `HEAD` only brings forward a write the next ordinary read
 * performs.
 *
 * It records no audit event, and that is what makes it pollable. `/export` is
 * the audited, portable, sanitized read; this one is the unsanitized draft a
 * caller reads before writing it back.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowStateContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.id }),
  useCase: readWorkflowGraph,
  present: ({ blocks, edges, loops, parallels, variables }) => ({
    data: { blocks, edges, loops, parallels, variables },
  }),
})

export const PUT = defineV2JsonRoute({
  contract: v2ReplaceWorkflowStateContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.replaceState,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  parseOptions: { maxBodyBytes: MAX_IMPORT_BODY_BYTES },
  mapInput: ({ params, body }) => ({
    workflowId: params.id,
    // double-cast-allowed: the wire schema leaves sub-block `type` an open string, which the domain type narrows to the block registry's union; the persistence layer re-validates every sub-block.
    blocks: body.blocks as unknown as Record<string, BlockState>,
    edges: body.edges as WorkflowState['edges'],
    variables: body.variables,
  }),
  useCase: replaceWorkflowState,
  present: ({ workflowId, warnings, needsRedeployment }) => ({
    data: { id: workflowId, warnings, needsRedeployment },
  }),
})
