import { v2AbortFileUploadContract } from '@/lib/api/contracts/v2/files'
import { abortUploadSession, getOwnedUploadSession } from '@/lib/uploads/upload-session/service'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

export const DELETE = withPublicApiRouteHandler({
  contract: v2AbortFileUploadContract,
  rateLimitEndpoint: 'files',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
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
      const aborted = await abortUploadSession(session)
      return v2Data(await toV2FileUpload(aborted, null), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
