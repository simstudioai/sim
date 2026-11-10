import { v2ListWorkflowTriggersContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { presentV2WorkflowTrigger, v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { listWorkflowTriggers } from '@/lib/workflows/application/triggers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflows/[workflowId]/triggers — health of every trigger the
 * live deployment serves.
 *
 * Disabled triggers are listed, because finding the ones that switched
 * themselves off after repeated failures is what this read is for; the
 * deployment read publishes only the webhooks currently accepting deliveries.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListWorkflowTriggersContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.readTriggers,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.workflowId }),
  useCase: listWorkflowTriggers,
  present: ({ triggers }) => ({
    data: triggers.map(presentV2WorkflowTrigger),
    nextCursor: null,
  }),
})
