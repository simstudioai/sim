import { SOURCE_REQUEST_MAX_BYTES } from '@sim/workflow-code/limits'
import { v2PlanWorkflowSourceContract } from '@/lib/api/contracts/v2/workflow-source'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { presentSourceOutcome, v2WorkflowErrorPolicies, withSourceSlot } from '@/lib/workflows/api'
import { planWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/workflows/[workflowId]/source/plan — what applying the submitted source would do,
 * without writing: the dry run `sim workflows source status` reads. A read at the `read` role on
 * the source-plan budget (`v2RateLimits.sourcePlan`), so asking for a status never spends the
 * source-write budget an apply needs; a server already running as many plans as it allows
 * answers 429. Answers 403 while the `workflow-code` flag is off.
 */
export const POST = defineV2JsonRoute({
  contract: v2PlanWorkflowSourceContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.planSource,
  rateLimit: v2RateLimits.sourcePlan,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowGraphAuthorization,
  parseOptions: { maxBodyBytes: SOURCE_REQUEST_MAX_BYTES },
  mapInput: ({ params, query, body }) => ({
    workflowId: params.workflowId,
    files: body.files,
    lock: body.lock,
    base: body.base,
    ...(query.allowDelete !== undefined ? { allowDelete: query.allowDelete } : {}),
  }),
  useCase: withSourceSlot(planWorkflowSource, 'plan'),
  present: (result) => ({ data: presentSourceOutcome(result) }),
})
