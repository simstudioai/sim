import type { V2WorkflowVersionDetail } from '@/lib/api/contracts/v2/workflows'
import { v2GetWorkflowVersionContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readWorkflowVersion } from '@/lib/workflows/application/read-workflow-version'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowVersionContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.readVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.id, version: params.version }),
  useCase: readWorkflowVersion,
  present: ({ version }) => ({
    data: {
      id: version.id,
      version: version.version,
      name: version.name,
      description: version.description,
      isActive: version.isActive,
      createdAt: version.createdAt.toISOString(),
      state: version.state as V2WorkflowVersionDetail['state'],
    },
  }),
})
