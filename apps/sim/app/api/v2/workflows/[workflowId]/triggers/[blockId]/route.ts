import { v2UpdateWorkflowTriggerContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { presentV2WorkflowTrigger, v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { setWorkflowTriggerEnabled } from '@/lib/workflows/application/triggers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * PATCH /api/v2/workflows/[workflowId]/triggers/[blockId] — enable or disable
 * one trigger of the live deployment without redeploying.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateWorkflowTriggerContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.setTriggerEnabled,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, body }) => ({
    target: { kind: 'block' as const, workflowId: params.workflowId, blockId: params.blockId },
    enabled: body.enabled,
  }),
  useCase: setWorkflowTriggerEnabled,
  present: ({ trigger }) => ({ data: presentV2WorkflowTrigger(trigger) }),
})
