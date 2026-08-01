import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2MoveFileItemsContract } from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performMoveWorkspaceFileItems } from '@/lib/workspace-files/orchestration'
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

const logger = createLogger('V2FileMoveAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/files/move — Move files and/or folders into a folder.
 *
 * `targetFolderId: null` (or an omitted field) moves the selection to the
 * workspace root. The whole selection moves under one advisory lock, so a name
 * collision at the destination fails the request as `CONFLICT` rather than
 * partially applying.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-move')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2MoveFileItemsContract,
      request,
      {},
      { validationErrorResponse: v2ValidationError }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, fileIds, folderIds, targetFolderId } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performMoveWorkspaceFileItems({
      workspaceId,
      userId,
      fileIds,
      folderIds,
      targetFolderId: targetFolderId ?? null,
    })

    if (!result.success || !result.movedItems) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to move file items')
      )
    }

    return v2Data({ movedItems: result.movedItems }, { rateLimit })
  } catch (error) {
    logger.error('Error moving file items', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
