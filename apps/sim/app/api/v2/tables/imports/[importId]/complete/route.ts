import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CompleteTableImportContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { markTrackedImportTerminal } from '@/lib/table/import-resource-store'
import {
  getOwnedTableImport,
  startUploadedTableImport,
  toV2TableImport,
} from '@/lib/table/orchestration/import-resource'
import {
  completeUploadSession,
  getOwnedUploadSession,
} from '@/lib/uploads/multipart-session/service'
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
import { v2TableLockError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2CompleteTableImportAPI')

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
      const parsed = await parseRequest(v2CompleteTableImportContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response
      const { workspaceId } = parsed.data.query
      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const record = await getOwnedTableImport({
        importId: parsed.data.params.importId,
        workspaceId,
        userId,
      })
      if (!record.uploadSessionId) return v2Error('CONFLICT', 'Import has no upload source')
      const upload = await getOwnedUploadSession({
        uploadId: record.uploadSessionId,
        workspaceId,
        userId,
      })
      await completeUploadSession({
        session: upload,
        parts: parsed.data.body.parts,
        finalize: async () => ({ value: null }),
        onFailure: async (_session, error) => {
          await markTrackedImportTerminal({
            importId: record.id,
            status: 'failed',
            error: getErrorMessage(error, 'Upload finalization failed'),
          })
        },
      })
      const started = await startUploadedTableImport(record.id)
      return v2Data(await toV2TableImport(started), { rateLimit })
    } catch (error) {
      const lockError = v2TableLockError(error)
      if (lockError) return lockError
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      logger.error('Failed to complete table import upload', { error: getErrorMessage(error) })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
