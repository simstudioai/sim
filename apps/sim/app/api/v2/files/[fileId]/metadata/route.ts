import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2GetFileContract } from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2File } from '@/app/api/v2/files/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FileMetadataAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface FileMetadataRouteParams {
  params: Promise<{ fileId: string }>
}

/** GET /api/v2/files/[fileId]/metadata — Return file metadata without downloading its bytes. */
export const GET = withRouteHandler(
  async (request: NextRequest, context: FileMetadataRouteParams) => {
    try {
      const rateLimit = await checkRateLimit(request, 'file-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!
      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(v2GetFileContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { fileId } = parsed.data.params
      const { workspaceId } = parsed.data.query

      const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
      if (access) return v2WorkspaceAccessError(access)

      const file = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
      if (!file) return v2Error('NOT_FOUND', 'File not found')

      return v2Data(toV2File(file), { rateLimit })
    } catch (error) {
      logger.error('Error fetching file metadata', {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
