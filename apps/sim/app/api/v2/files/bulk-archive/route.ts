import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2BulkArchiveFileItemsContract } from '@/lib/api/contracts/v2/files'
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

const logger = createLogger('V2FileBulkArchiveAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/files/bulk-archive — Archive (soft delete) files and folders.
 *
 * Archiving a folder cascades to its descendants; `deletedItems` reports the
 * totals actually archived, which therefore exceed the selection size. Archived
 * items stay listable via `scope=archived` and can be restored.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-bulk-archive')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2BulkArchiveFileItemsContract,
      request,
      {},
      { validationErrorResponse: v2ValidationError }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, fileIds, folderIds } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performDeleteWorkspaceFileItems({
      workspaceId,
      userId,
      fileIds,
      folderIds,
      request,
    })

    if (!result.success || !result.deletedItems) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to archive file items')
      )
    }

    return v2Data({ deletedItems: result.deletedItems }, { rateLimit })
  } catch (error) {
    logger.error('Error archiving file items', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
