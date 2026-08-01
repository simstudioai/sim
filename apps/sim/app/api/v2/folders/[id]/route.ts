import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2DeleteFolderContract,
  v2GetFolderContract,
  v2UpdateFolderContract,
} from '@/lib/api/contracts/v2/folders'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { folderResourceConfig } from '@/lib/folders/config'
import { deleteFolder, updateFolder } from '@/lib/folders/lifecycle'
import { findActiveFolder, findFolderInWorkspace } from '@/lib/folders/queries'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2Folder, v2FolderMutationError } from '@/app/api/v2/folders/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FolderDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteContext {
  params: Promise<{ id: string }>
}

/** GET /api/v2/folders/[id] — Fetch a single folder, archived or live. */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'folder-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2GetFolderContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId, resourceType } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const folder = await findFolderInWorkspace(id, workspaceId, resourceType)
    if (!folder) return v2Error('NOT_FOUND', 'Folder not found')

    return v2Data({ folder: toV2Folder(folder) }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching folder`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** PATCH /api/v2/folders/[id] — Rename, move, reorder, or lock a folder. */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'folder-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2UpdateFolderContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId, resourceType, name, locked, parentId, sortOrder } = parsed.data.body

    /**
     * Setting `locked` is an admin capability, matching the UI; every other
     * field needs only workspace write.
     */
    const access = await resolveWorkspaceAccess(
      rateLimit,
      userId,
      workspaceId,
      locked === undefined ? 'write' : 'admin'
    )
    if (access) return v2WorkspaceAccessError(access)

    /**
     * Archived folders are excluded deliberately: `getFolderLockStatus` skips
     * archived rows, so an archived-but-locked folder reports unlocked. Without
     * this filter, deleting a folder would make every locked subfolder under it
     * freely renameable and reparentable.
     */
    const existing = await findActiveFolder(id, workspaceId, resourceType)
    if (!existing) return v2Error('NOT_FOUND', 'Folder not found')

    const supportsLocking = Boolean(folderResourceConfig(resourceType).supportsLocking)
    if (locked !== undefined && !supportsLocking) {
      return v2Error('BAD_REQUEST', 'Folder locking is only supported for workflow folders')
    }

    if (supportsLocking) {
      const hasNonLockUpdate =
        name !== undefined || parentId !== undefined || sortOrder !== undefined
      if (hasNonLockUpdate) await assertFolderMutable(id)
      if (parentId !== undefined) await assertFolderMutable(parentId)
    }

    const result = await updateFolder({
      resourceType,
      folderId: id,
      workspaceId,
      userId,
      name,
      locked,
      parentId,
      sortOrder,
    })

    if (!result.success || !result.folder) {
      return v2FolderMutationError(result.errorCode, result.error ?? 'Failed to update folder')
    }

    return v2Data({ folder: toV2Folder(result.folder) }, { rateLimit })
  } catch (error) {
    if (error instanceof FolderLockedError) return v2Error('LOCKED', error.message)

    logger.error(`[${requestId}] Error updating folder`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** DELETE /api/v2/folders/[id] — Archive a folder and cascade to its contents. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'folder-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2DeleteFolderContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId, resourceType } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    /**
     * Archived rows are included on purpose: `deleteFolder` reuses an already
     * archived folder's own `deletedAt` so a cascade that failed partway can be
     * retried onto the same snapshot. 404ing here would strand those.
     */
    const existing = await findFolderInWorkspace(id, workspaceId, resourceType)
    if (!existing) return v2Error('NOT_FOUND', 'Folder not found')

    if (folderResourceConfig(resourceType).supportsLocking) {
      await assertFolderMutable(id)
    }

    const result = await deleteFolder({
      resourceType,
      folderId: id,
      workspaceId,
      userId,
      folderName: existing.name,
    })

    if (!result.success) {
      return v2FolderMutationError(result.errorCode, result.error ?? 'Failed to delete folder')
    }

    return v2Data({ id, deleted: true as const, deletedItems: result.deletedItems }, { rateLimit })
  } catch (error) {
    if (error instanceof FolderLockedError) return v2Error('LOCKED', error.message)

    logger.error(`[${requestId}] Error deleting folder`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
