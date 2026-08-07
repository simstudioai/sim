import { v2CompleteFileUploadContract } from '@/lib/api/contracts/v2/files'
import { completeUploadSession, getOwnedUploadSession } from '@/lib/uploads/upload-session/service'
import { finalizeWorkspaceFileUpload } from '@/app/api/files/uploads/finalizers'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

export const POST = withPublicApiRouteHandler({
  contract: v2CompleteFileUploadContract,
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
      const actorUserId = session.metadata.actorUserId
      if (typeof actorUserId !== 'string') {
        throw new Error('Workspace file upload is missing its attribution actor')
      }
      const result = await completeUploadSession({
        session,
        finalize: async (claimed) => {
          const finalized = await finalizeWorkspaceFileUpload({
            session: claimed,
            actor: { id: actorUserId },
            request,
            source: 'api',
          })
          return { value: finalized.file, completedFileId: finalized.file.id }
        },
      })
      return v2Data(await toV2FileUpload(result.session, result.value), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
