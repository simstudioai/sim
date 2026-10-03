import { v2DuplicateWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { workspaceResourceWebUrl } from '@/lib/resources'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { duplicateWorkflow } from '@/lib/workflows/application/duplicate-workflow'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = defineV2JsonRoute({
  contract: v2DuplicateWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.duplicate,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, body }) => ({
    sourceWorkflowId: params.workflowId,
    name: body.name,
    folderPath: body.folderPath,
  }),
  useCase: duplicateWorkflow,
  present: (result) => ({
    data: {
      id: result.id,
      webUrl: workspaceResourceWebUrl(getBaseUrl(), result.workspaceId, 'workflow', result.id),
      name: result.name,
      description: result.description,
      folderPath: result.folderPath,
      workspaceId: result.workspaceId,
      isDeployed: false,
      deployedAt: null,
      runCount: 0,
      lastRunAt: null,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    },
  }),
})
