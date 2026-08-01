import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2RestoreFileFolderContract } from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performRestoreWorkspaceFileFolder } from '@/lib/workspace-files/orchestration'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2FileFolder } from '@/app/api/v2/files/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FileFolderRestoreAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface FolderRouteParams {
  params: Promise<{ folderId: string }>
}

/**
 * POST /api/v2/files/folders/[folderId]/restore — Restore an archived folder.
 *
 * Restores the whole subtree that was archived with it; `restoredItems` counts
 * the folder itself among `folders`.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: FolderRouteParams) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-folder-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2RestoreFileFolderContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { folderId } = parsed.data.params
    const { workspaceId } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performRestoreWorkspaceFileFolder({ workspaceId, folderId, userId })

    if (!result.success || !result.folder || !result.restoredItems) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to restore folder')
      )
    }

    return v2Data(
      { folder: toV2FileFolder(result.folder), restoredItems: result.restoredItems },
      { rateLimit }
    )
  } catch (error) {
    logger.error('Error restoring file folder', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
