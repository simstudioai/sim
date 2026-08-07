import { v2CreateFileUploadContract } from '@/lib/api/contracts/v2/files'
import { createUploadSession } from '@/lib/uploads/upload-session/service'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'
import { resolveFolderPathIdentity } from '@/app/api/v2/lib/folders'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

export const POST = withPublicApiRouteHandler({
  contract: v2CreateFileUploadContract,
  rateLimitEndpoint: 'files',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    try {
      const { workspaceId, name, contentType, size, folderPath } = input.body
      const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
      if (access) return v2WorkspaceAccessError(access)
      const resolution = await resolveFolderPathIdentity({
        workspaceId,
        resourceType: 'file',
        path: folderPath ?? '/',
      })
      if (!resolution.found) return v2Error('NOT_FOUND', 'Folder not found')
      const session = await createUploadSession({
        workspaceId,
        userId,
        purpose: 'workspace_file',
        fileName: name,
        contentType,
        fileSize: size,
        metadata: { folderId: resolution.folderId },
        localOrigin: request.nextUrl.origin,
      })
      return v2Data(
        {
          session: await toV2FileUpload(session, null),
          uploadToken: session.uploadToken,
          transfer: session.transfer,
        },
        { rateLimit, status: 201 }
      )
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
