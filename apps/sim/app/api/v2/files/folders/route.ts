import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CreateFileFolderContract, v2ListFileFoldersContract } from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listWorkspaceFileFolders } from '@/lib/uploads/contexts/workspace'
import { performCreateWorkspaceFileFolder } from '@/lib/workspace-files/orchestration'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2FileFolder } from '@/app/api/v2/files/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CursorList,
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FileFoldersAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/files/folders — List a workspace's file-folder tree.
 *
 * File folders live in the `folder` table but are deliberately not served by
 * `/api/v2/folders`: their mutations run behind a per-workspace advisory lock
 * and their names are path segments, neither of which the generic folder engine
 * enforces.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-folders')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ListFileFoldersContract,
      request,
      {},
      { validationErrorResponse: v2ValidationError }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, scope } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const folders = await listWorkspaceFileFolders(workspaceId, { scope })

    // One workspace's file-folder tree is bounded → a single full page.
    return v2CursorList(folders.map(toV2FileFolder), null, { rateLimit })
  } catch (error) {
    logger.error('Error listing file folders', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** POST /api/v2/files/folders — Create a file folder. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-folders')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2CreateFileFolderContract,
      request,
      {},
      { validationErrorResponse: v2ValidationError }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, name, parentId } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performCreateWorkspaceFileFolder({
      workspaceId,
      userId,
      name,
      parentId: parentId ?? null,
    })

    if (!result.success || !result.folder) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to create folder')
      )
    }

    return v2Data(toV2FileFolder(result.folder), { rateLimit, status: 201 })
  } catch (error) {
    logger.error('Error creating file folder', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
