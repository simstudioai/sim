import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2DeleteFileFolderContract,
  v2UpdateFileFolderContract,
} from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  performDeleteWorkspaceFileItems,
  performUpdateWorkspaceFileFolder,
} from '@/lib/workspace-files/orchestration'
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

const logger = createLogger('V2FileFolderDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface FolderRouteParams {
  params: Promise<{ folderId: string }>
}

/**
 * PATCH /api/v2/files/folders/[folderId] — Rename, reparent, or reorder a folder.
 *
 * Reparenting is cycle-checked inside the workspace's file-folder advisory lock,
 * so making a folder its own descendant fails as `BAD_REQUEST` rather than
 * corrupting the tree.
 */
export const PATCH = withRouteHandler(async (request: NextRequest, context: FolderRouteParams) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-folder-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2UpdateFileFolderContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { folderId } = parsed.data.params
    const { workspaceId, name, parentId, sortOrder } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performUpdateWorkspaceFileFolder({
      workspaceId,
      folderId,
      userId,
      name,
      parentId,
      sortOrder,
    })

    if (!result.success || !result.folder) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to update folder')
      )
    }

    return v2Data(toV2FileFolder(result.folder), { rateLimit })
  } catch (error) {
    logger.error('Error updating file folder', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/**
 * DELETE /api/v2/files/folders/[folderId] — Archive a folder and its contents.
 *
 * `deletedItems` counts the whole cascade, not just this folder.
 */
export const DELETE = withRouteHandler(async (request: NextRequest, context: FolderRouteParams) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-folder-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2DeleteFileFolderContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { folderId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performDeleteWorkspaceFileItems({
      workspaceId,
      userId,
      folderIds: [folderId],
      request,
    })

    if (!result.success || !result.deletedItems) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to delete folder')
      )
    }

    return v2Data(
      { id: folderId, deleted: true as const, deletedItems: result.deletedItems },
      { rateLimit }
    )
  } catch (error) {
    logger.error('Error deleting file folder', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
