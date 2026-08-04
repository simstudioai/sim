import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2TableExportDownloadContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { requireTableExport, tableExportResult } from '@/lib/table/orchestration/export-resource'
import { generatePresignedDownloadUrl } from '@/lib/uploads/core/storage-service'
import { checkAccess } from '@/app/api/table/utils'
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

const logger = createLogger('V2TableExportDownloadAPI')
const DOWNLOAD_TTL_SECONDS = 60 * 60

interface TableExportRouteParams {
  params: Promise<{ exportId: string }>
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: TableExportRouteParams) => {
    try {
      const rateLimit = await checkRateLimit(request, 'table-export')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
      const userId = rateLimit.userId!
      const gate = await v2ApiGateError(userId)
      if (gate) return gate
      const parsed = await parseRequest(v2TableExportDownloadContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response
      const { workspaceId } = parsed.data.query
      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const record = await requireTableExport(parsed.data.params.exportId, workspaceId)
      const access = await checkAccess(record.tableId, userId, 'read')
      if (!access.ok || access.table.workspaceId !== workspaceId) {
        return v2Error('NOT_FOUND', 'Table export not found')
      }
      const result = tableExportResult(record)
      const url = await generatePresignedDownloadUrl(
        result.resultKey,
        'workspace',
        DOWNLOAD_TTL_SECONDS
      )
      return v2Data(
        {
          url,
          fileName: result.resultKey.split('/').pop() ?? `export.${result.format}`,
          expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
        },
        { rateLimit }
      )
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      logger.error('Failed to issue table export download', { error: getErrorMessage(error) })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
