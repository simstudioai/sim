import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CreateFolderContract, v2ListFoldersContract } from '@/lib/api/contracts/v2/folders'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { folderResourceConfig } from '@/lib/folders/config'
import { createFolder } from '@/lib/folders/lifecycle'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2Folder, toV2FolderFromApi, v2FolderMutationError } from '@/app/api/v2/folders/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CursorList,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FoldersAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/folders — List a workspace's folder tree for one resource type. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'folders')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ListFoldersContract,
      request,
      {},
      { validationErrorResponse: v2ValidationError }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, resourceType, scope } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const folders = await listFoldersForWorkspace(workspaceId, scope, resourceType)

    // One workspace's tree for one resource type is bounded → a single full page.
    return v2CursorList(folders.map(toV2FolderFromApi), null, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error listing folders`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** POST /api/v2/folders — Create a folder in one of a workspace's resource trees. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'folders')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2CreateFolderContract,
      request,
      {},
      { validationErrorResponse: v2ValidationError }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, resourceType, name, parentId, sortOrder } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    // Locking is a workflow-only feature; other trees leave `locked` false.
    if (folderResourceConfig(resourceType).supportsLocking) {
      await assertFolderMutable(parentId ?? null)
    }

    const result = await createFolder({
      resourceType,
      userId,
      workspaceId,
      name,
      parentId,
      sortOrder,
    })

    if (!result.success || !result.folder) {
      return v2FolderMutationError(result.errorCode, result.error ?? 'Failed to create folder')
    }

    return v2Data({ folder: toV2Folder(result.folder) }, { rateLimit, status: 201 })
  } catch (error) {
    if (error instanceof FolderLockedError) return v2Error('LOCKED', error.message)

    logger.error(`[${requestId}] Error creating folder`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
