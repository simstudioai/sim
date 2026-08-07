import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2UpdateFileContentContract } from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
  performUpdateWorkspaceFileContent,
} from '@/lib/workspace-files/orchestration'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2File } from '@/app/api/v2/files/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FileContentAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface FileRouteParams {
  params: Promise<{ fileId: string }>
}

/**
 * PUT /api/v2/files/[fileId]/content — Replace a file's bytes.
 *
 * A full replace, not an append: `content` becomes the entire body of the file.
 * `encoding: 'base64'` carries non-UTF-8 bytes. The decoded body is capped at
 * 50 MB and still debits the workspace storage quota, so a write that would push
 * the payer past its limit fails with 413.
 */
export const PUT = withRouteHandler(async (request: NextRequest, context: FileRouteParams) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-content')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2UpdateFileContentContract, request, context, {
      invalidJsonResponse: () => v2Error('BAD_REQUEST', 'Request body must be valid JSON'),
      maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) {
      return parsed.response.status === 413
        ? v2Error('PAYLOAD_TOO_LARGE', 'Request body is too large')
        : parsed.response
    }

    const { fileId } = parsed.data.params
    const { workspaceId, content, encoding } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performUpdateWorkspaceFileContent({
      workspaceId,
      fileId,
      userId,
      content,
      encoding,
      request,
    })

    if (!result.success || !result.file) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to update file content')
      )
    }

    return v2Data(await toV2File(result.file), { rateLimit })
  } catch (error) {
    logger.error('Error updating file content', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
