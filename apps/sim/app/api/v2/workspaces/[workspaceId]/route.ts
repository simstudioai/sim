import {
  v2GetWorkspaceContract,
  v2UpdateWorkspaceContract,
} from '@/lib/api/contracts/v2/workspaces'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkspaceErrorPolicies } from '@/lib/workspaces/api/route-policies'
import { getPublicWorkspace } from '@/lib/workspaces/application/get-public-workspace'
import {
  workspaceOperations,
  workspaceUpdateOperations,
} from '@/lib/workspaces/application/operations'
import { updateWorkspaceIdentity } from '@/lib/workspaces/application/update-workspace'
import type { PublicWorkspaceDetail } from '@/lib/workspaces/public-queries'

function presentWorkspace(workspace: PublicWorkspaceDetail) {
  return {
    data: {
      ...workspace,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    },
  }
}

/** GET /api/v2/workspaces/[workspaceId] — Public workspace metadata. */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkspaceContract,
  auth: v2ApiKeyAuth,
  operation: workspaceOperations.readPublicDetail,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkspaceErrorPolicies.concealWorkspaceAuthorization,
  mapInput: ({ params }) => ({ workspaceId: params.workspaceId }),
  useCase: getPublicWorkspace,
  present: ({ workspace }) => presentWorkspace(workspace),
})

/** PATCH /api/v2/workspaces/[workspaceId] — Rename a workspace or change its logo. */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateWorkspaceContract,
  auth: v2ApiKeyAuth,
  operation: workspaceUpdateOperations.updateIdentity,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkspaceErrorPolicies.concealWorkspaceAuthorization,
  mapInput: ({ params, body }) => ({ workspaceId: params.workspaceId, patch: body }),
  useCase: updateWorkspaceIdentity,
  present: ({ workspace }) => presentWorkspace(workspace),
})
