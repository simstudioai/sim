import { v2CompareWorkflowVersionsContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { compareWorkflowVersions } from '@/lib/workflows/application/compare-workflow-versions'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const GET = defineV2JsonRoute({
  contract: v2CompareWorkflowVersionsContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.compareVersions,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, query }) => ({
    workflowId: params.workflowId,
    base: query.base,
    target: query.target,
  }),
  useCase: compareWorkflowVersions,
  present: (result) => ({ data: result }),
})
