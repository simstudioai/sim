import { v2PreviewWorkflowRunFromBlockContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { previewManualWorkflowFromBlock } from '@/lib/workflows/application/preview-manual-workflow-from-block'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2PreviewWorkflowRunFromBlockContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.previewManualFromBlock,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, query }) => ({ workflowId: params.workflowId, ...query }),
  useCase: previewManualWorkflowFromBlock,
  present: (data) => ({ data }),
})
