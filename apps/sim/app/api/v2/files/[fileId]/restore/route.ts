import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2RestoreFileContract } from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performRestoreWorkspaceFile } from '@/lib/workspace-files/orchestration'
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

const logger = createLogger('V2FileRestoreAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface FileRouteParams {
  params: Promise<{ fileId: string }>
}

/**
 * POST /api/v2/files/[fileId]/restore — Restore an archived file.
 *
 * Find archived ids with `GET /api/v2/files?scope=archived`. A name collision
 * with a live file is resolved by the manager's restore-name suffix, so the
 * restored file may come back under a different name.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: FileRouteParams) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2RestoreFileContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { fileId } = parsed.data.params
    const { workspaceId } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performRestoreWorkspaceFile({ workspaceId, fileId, userId })

    if (!result.success) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to restore file')
      )
    }

    return v2Data({ id: fileId, restored: true as const }, { rateLimit })
  } catch (error) {
    logger.error('Error restoring file', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
