import { v2GetWorkflowOutlineContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readWorkflowOutline } from '@/lib/workflows/application/read-workflow-graph'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflows/[workflowId]/outline — the draft as a compact,
 * read-only outline. Head-safe and unaudited for the same reasons as
 * `GET /api/v2/workflows/{workflowId}/state`, which it projects.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowOutlineContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.workflowId }),
  useCase: readWorkflowOutline,
  present: ({ blocks }) => ({ data: { blocks } }),
})
