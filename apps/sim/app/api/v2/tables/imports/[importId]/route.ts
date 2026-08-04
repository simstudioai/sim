import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2CancelTableImportContract,
  v2GetTableImportContract,
} from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  abortTableImportUpload,
  cancelTableImportResource,
  getOwnedTableImport,
  toV2TableImport,
} from '@/lib/table/orchestration/import-resource'
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

const logger = createLogger('V2TableImportAPI')

interface TableImportRouteParams {
  params: Promise<{ importId: string }>
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: TableImportRouteParams) => {
    try {
      const rateLimit = await checkRateLimit(request, 'table-import')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
      const userId = rateLimit.userId!
      const gate = await v2ApiGateError(userId)
      if (gate) return gate
      const parsed = await parseRequest(v2GetTableImportContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response
      const scopeError = await resolveWorkspaceScope(rateLimit, parsed.data.query.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const record = await getOwnedTableImport({
        importId: parsed.data.params.importId,
        workspaceId: parsed.data.query.workspaceId,
        userId,
      })
      return v2Data(await toV2TableImport(record), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      logger.error('Failed to read table import', { error: getErrorMessage(error) })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: TableImportRouteParams) => {
    try {
      const rateLimit = await checkRateLimit(request, 'table-import')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
      const userId = rateLimit.userId!
      const gate = await v2ApiGateError(userId)
      if (gate) return gate
      const parsed = await parseRequest(v2CancelTableImportContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response
      const scopeError = await resolveWorkspaceScope(rateLimit, parsed.data.query.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const uploadToken = parsed.data.headers['upload-token']
      const record = uploadToken
        ? await abortTableImportUpload({
            importId: parsed.data.params.importId,
            workspaceId: parsed.data.query.workspaceId,
            userId,
            uploadToken,
          })
        : await cancelTableImportResource(
            await getOwnedTableImport({
              importId: parsed.data.params.importId,
              workspaceId: parsed.data.query.workspaceId,
              userId,
            })
          )
      return v2Data(toV2TableImport(record), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      logger.error('Failed to cancel table import', { error: getErrorMessage(error) })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
