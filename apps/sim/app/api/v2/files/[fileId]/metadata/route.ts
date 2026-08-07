import { v2GetFileContract } from '@/lib/api/contracts/v2/files'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2File } from '@/app/api/v2/files/utils'
import { v2Data, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/files/[fileId]/metadata — Return file metadata without downloading its bytes. */
export const GET = withPublicApiRouteHandler({
  contract: v2GetFileContract,
  rateLimitEndpoint: 'file-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { fileId } = input.params
    const { workspaceId } = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const file = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
    if (!file) return v2Error('NOT_FOUND', 'File not found')

    return v2Data(await toV2File(file), { rateLimit })
  },
})
