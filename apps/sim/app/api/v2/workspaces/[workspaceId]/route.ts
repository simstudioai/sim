import { v2GetWorkspaceContract } from '@/lib/api/contracts/v2/workspaces'
import { getPublicWorkspaceDetail } from '@/lib/workspaces/public-queries'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2Data, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'

/** GET /api/v2/workspaces/[workspaceId] — Public workspace metadata. */
export const GET = withPublicApiRouteHandler({
  contract: v2GetWorkspaceContract,
  rateLimitEndpoint: 'workspaces',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId } = input.params
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const workspace = await getPublicWorkspaceDetail(workspaceId)
    if (!workspace) return v2Error('NOT_FOUND', 'Workspace not found')

    return v2Data(
      {
        ...workspace,
        createdAt: workspace.createdAt.toISOString(),
        updatedAt: workspace.updatedAt.toISOString(),
      },
      { rateLimit }
    )
  },
})
