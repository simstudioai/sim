import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2AbortFileUploadContract } from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { abortUploadSession, getOwnedUploadSession } from '@/lib/uploads/upload-session/service'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FileUploadAPI')

interface FileUploadRouteParams {
  params: Promise<{ uploadId: string }>
}

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: FileUploadRouteParams) => {
    try {
      const rateLimit = await checkRateLimit(request, 'files')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
      const userId = rateLimit.userId!
      const gate = await v2ApiGateError(userId)
      if (gate) return gate
      const parsed = await parseRequest(v2AbortFileUploadContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response
      const { uploadId } = parsed.data.params
      const { workspaceId } = parsed.data.query
      const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
      if (access) return v2WorkspaceAccessError(access)
      const session = await getOwnedUploadSession({
        uploadId,
        workspaceId,
        userId,
        purpose: 'workspace_file',
        uploadToken: parsed.data.headers['upload-token'],
      })
      const aborted = await abortUploadSession(session)
      return v2Data(toV2FileUpload(aborted, null), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      logger.error('Failed to abort file upload session', { error: getErrorMessage(error) })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
