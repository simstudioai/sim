import { v2GetWorkflowSourceContract } from '@/lib/api/contracts/v2/workflow-source'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { getWorkflowSource } from '@/lib/workflows/application/get-workflow-source'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflows/[workflowId]/source — the draft as TypeScript source with its identity
 * lock and freshness fingerprint. Head-safe and unaudited, like `GET .../state`, which it
 * projects. Answers 403 while the `workflow-code` flag is off.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowSourceContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.readSource,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, query }) => ({
    workflowId: params.workflowId,
    ...(query.annotateIds !== undefined ? { annotateIds: query.annotateIds } : {}),
    ...(query.functionCode ? { functionCode: query.functionCode } : {}),
  }),
  useCase: getWorkflowSource,
  present: (source) => ({ data: source }),
})
