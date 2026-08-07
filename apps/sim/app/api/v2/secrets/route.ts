import { v2ListSecretsContract } from '@/lib/api/contracts/v2/secrets'
import { listVisibleWorkspaceCredentials } from '@/lib/credentials/queries'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2CursorList, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'
import { secretCredentialTypes, toV2Secret } from '@/app/api/v2/secrets/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/secrets — List secret names and metadata without reading their values. */
export const GET = withPublicApiRouteHandler({
  contract: v2ListSecretsContract,
  rateLimitEndpoint: 'secrets',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, scope, search, sortBy, sortOrder } = input.query
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)
    const isWorkspaceKey = rateLimit.keyType === 'workspace'
    if (isWorkspaceKey && scope === 'personal') {
      return v2Error('PERSONAL_KEY_REQUIRED', 'Personal secrets require a personal API key')
    }

    const workspaceAccess = isWorkspaceKey
      ? { canAdmin: true }
      : await checkWorkspaceAccess(workspaceId, userId)
    const credentials = await listVisibleWorkspaceCredentials({
      workspaceId,
      userId,
      workspaceAccess,
      types: [...secretCredentialTypes(isWorkspaceKey ? 'workspace' : scope)],
      search,
      sortBy: sortBy === 'name' ? 'displayName' : sortBy,
      sortOrder,
    })
    const secrets = credentials
      .filter(
        (row) => row.type === 'env_workspace' || (!isWorkspaceKey && row.envOwnerUserId === userId)
      )
      .map((row) => toV2Secret(row, userId))

    return v2CursorList(secrets, null, { rateLimit })
  },
})
