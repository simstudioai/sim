import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CreateTableExportContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createTableExportResource,
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

const logger = createLogger('V2TableExportsAPI')

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

export const POST = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  try {
    const rateLimit = await checkRateLimit(request, 'table-export')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate
    const parsed = await parseRequest(v2CreateTableExportContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response
    const { workspaceId, format } = parsed.data.body
    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)
    const access = await checkAccess(parsed.data.params.tableId, userId, 'read')
    if (!access.ok || access.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }
    const record = await createTableExportResource({ table: access.table, format })
    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.TABLE_EXPORTED,
      resourceType: AuditResourceType.TABLE,
      resourceId: access.table.id,
      resourceName: access.table.name,
      description: `Exported table "${access.table.name}" as ${format.toUpperCase()}`,
      metadata: { format, rowCount: access.table.rowCount },
      request,
    })
    return v2Data(toV2TableExport(record, true), { rateLimit, status: 201 })
  } catch (error) {
    const classified = v2CaughtOrchestrationError(error)
    if (classified) return classified
    logger.error('Failed to create table export', { error: getErrorMessage(error) })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
