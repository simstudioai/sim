import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2CancelTableExportContract,
  v2GetTableExportContract,
} from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  cancelTableExportResource,
  requireTableExport,
  toV2TableExport,
} from '@/lib/table/orchestration/export-resource'
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

const logger = createLogger('V2TableExportAPI')

interface TableExportRouteParams {
  params: Promise<{ exportId: string }>
}

async function authorizeExport(exportId: string, workspaceId: string, userId: string) {
  const record = await requireTableExport(exportId, workspaceId)
  const access = await checkAccess(record.tableId, userId, 'read')
  if (!access.ok || access.table.workspaceId !== workspaceId) return null
  return record
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: TableExportRouteParams) => {
    try {
      const rateLimit = await checkRateLimit(request, 'table-export')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
      const userId = rateLimit.userId!
      const gate = await v2ApiGateError(userId)
      if (gate) return gate
      const parsed = await parseRequest(v2GetTableExportContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response
      const { workspaceId } = parsed.data.query
      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const record = await authorizeExport(parsed.data.params.exportId, workspaceId, userId)
      if (!record) return v2Error('NOT_FOUND', 'Table export not found')
      return v2Data(toV2TableExport(record), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      logger.error('Failed to read table export', { error: getErrorMessage(error) })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: TableExportRouteParams) => {
    try {
      const rateLimit = await checkRateLimit(request, 'table-export')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
      const userId = rateLimit.userId!
      const gate = await v2ApiGateError(userId)
      if (gate) return gate
      const parsed = await parseRequest(v2CancelTableExportContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response
      const { workspaceId } = parsed.data.query
      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)
      const record = await authorizeExport(parsed.data.params.exportId, workspaceId, userId)
      if (!record) return v2Error('NOT_FOUND', 'Table export not found')
      return v2Data(toV2TableExport(await cancelTableExportResource(record)), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      logger.error('Failed to cancel table export', { error: getErrorMessage(error) })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
