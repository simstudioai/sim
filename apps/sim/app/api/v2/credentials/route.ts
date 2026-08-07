import { v2ListCredentialsContract } from '@/lib/api/contracts/v2/credentials'
import { listVisibleWorkspaceCredentials } from '@/lib/credentials/queries'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2Credential } from '@/app/api/v2/credentials/utils'
import { v2CursorList, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/credentials — List the credentials the caller can see in a workspace. */
export const GET = withPublicApiRouteHandler({
  contract: v2ListCredentialsContract,
  rateLimitEndpoint: 'credentials',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, type, providerId, search, sortBy, sortOrder } = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    /**
     * Credential visibility is per credential, not per workspace: membership
     * rows and shared-type admin access decide what this caller sees, so the
     * workspace permission is re-read here for the `canAdmin` bit.
     */
    const workspaceAccess =
      rateLimit.keyType === 'workspace'
        ? { canAdmin: true }
        : await checkWorkspaceAccess(workspaceId, userId)
    const credentials = await listVisibleWorkspaceCredentials({
      workspaceId,
      userId,
      workspaceAccess,
      types: type ? [type] : ['oauth', 'service_account'],
      providerId,
      search,
      sortBy,
      sortOrder,
    })

    // The per-workspace credential set is small and bounded → a single full page.
    return v2CursorList(credentials.map(toV2Credential), null, { rateLimit })
  },
})
