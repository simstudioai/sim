import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CreateFileUploadContract } from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { createUploadSession } from '@/lib/uploads/upload-session/service'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'
import { resolveFolderPathId } from '@/app/api/v2/lib/folders'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FileUploadsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'files')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2CreateFileUploadContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response
    const { workspaceId, name, contentType, size, folderPath } = parsed.data.body
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)
    const folderIndex = await loadActiveFolderPathIndex(workspaceId, 'file')
    const normalizedFolderId = resolveFolderPathId(folderIndex, folderPath ?? '/')
    if (normalizedFolderId === undefined) return v2Error('NOT_FOUND', 'Folder not found')

    const session = await createUploadSession({
      workspaceId,
      userId,
      purpose: 'workspace_file',
      fileName: name,
      contentType,
      fileSize: size,
      metadata: { folderId: normalizedFolderId },
      localOrigin: request.nextUrl.origin,
    })
    return v2Data(
      {
        session: toV2FileUpload(session, null),
        uploadToken: session.uploadToken,
        transfer: session.transfer,
      },
      { rateLimit, status: 201 }
    )
  } catch (error) {
    const classified = v2CaughtOrchestrationError(error)
    if (classified) return classified
    logger.error('Failed to create file upload session', { error: getErrorMessage(error) })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
