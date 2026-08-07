import { v2CreateFileUploadPartUrlsContract } from '@/lib/api/contracts/v2/files'
import { createUploadPartUrls, getOwnedUploadSession } from '@/lib/uploads/upload-session/service'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

export const POST = withPublicApiRouteHandler({
  contract: v2CreateFileUploadPartUrlsContract,
  rateLimitEndpoint: 'files',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    try {
      const { uploadId } = input.params
      const { workspaceId } = input.query
      const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
      if (access) return v2WorkspaceAccessError(access)
      const session = await getOwnedUploadSession({
        uploadId,
        workspaceId,
        userId: rateLimit.principalUserId ?? userId,
        purpose: 'workspace_file',
        uploadToken: input.headers['upload-token'],
      })
      const parts = await createUploadPartUrls({
        session,
        partNumbers: input.body.partNumbers,
        localOrigin: request.nextUrl.origin,
      })
      return v2Data({ parts }, { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
