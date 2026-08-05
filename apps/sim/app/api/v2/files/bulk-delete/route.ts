import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2BulkDeleteFilesContract } from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performDeleteWorkspaceFileItems } from '@/lib/workspace-files/orchestration'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FileBulkDeleteAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/files/bulk-delete — Delete files. Folder deletion is owned by
 * `/api/v2/files/folders` so this resource operation never accepts folder ids.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-bulk-delete')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2BulkDeleteFilesContract,
      request,
      {},
      { validationErrorResponse: v2ValidationError }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, fileIds } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performDeleteWorkspaceFileItems({
      workspaceId,
      userId,
      fileIds,
      request,
    })

    if (!result.success || !result.deletedItems) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to delete files')
      )
    }

    return v2Data({ deletedItems: { files: result.deletedItems.files } }, { rateLimit })
  } catch (error) {
    logger.error('Error deleting files', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
