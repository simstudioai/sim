import { v2GetWorkspaceContract } from '@/lib/api/contracts/v2/workspaces'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkspaceErrorPolicies } from '@/lib/workspaces/api/route-policies'
import { getPublicWorkspace } from '@/lib/workspaces/application/get-public-workspace'
import { workspaceOperations } from '@/lib/workspaces/application/operations'

/** GET /api/v2/workspaces/[workspaceId] — Public workspace metadata. */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkspaceContract,
  auth: v2ApiKeyAuth,
  operation: workspaceOperations.readPublicDetail,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkspaceErrorPolicies.concealWorkspaceAuthorization,
  mapInput: ({ params }) => ({ workspaceId: params.workspaceId }),
  useCase: getPublicWorkspace,
  present: ({ workspace }) => ({
    data: {
      ...workspace,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    },
  }),
})
