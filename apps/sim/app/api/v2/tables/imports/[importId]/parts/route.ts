import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CreateTableImportPartUrlsContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getOwnedTableImportUpload } from '@/lib/table/orchestration/import-resource'
import { createUploadPartUrls } from '@/lib/uploads/upload-session/service'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2TableImportPartsAPI')

interface TableImportRouteParams {
  params: Promise<{ importId: string }>
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: TableImportRouteParams) => {
    try {
      const rateLimit = await checkRateLimit(request, 'table-import')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
      const userId = rateLimit.userId!
      const gate = await v2ApiGateError(userId)
      if (gate) return gate
      const parsed = await parseRequest(v2CreateTableImportPartUrlsContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response
      const { workspaceId } = parsed.data.query
      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const session = getOwnedTableImportUpload({
        importId: parsed.data.params.importId,
        workspaceId,
        userId,
        uploadToken: parsed.data.headers['upload-token'],
      })
      const parts = await createUploadPartUrls({
        session,
        partNumbers: parsed.data.body.partNumbers,
        localOrigin: request.nextUrl.origin,
      })
      return v2Data({ parts }, { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      logger.error('Failed to create table import part URLs', { error: getErrorMessage(error) })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
