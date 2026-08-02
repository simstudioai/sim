import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { v2ExportTableContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  createTableExportStream,
  exportContentType,
  sanitizeExportFilename,
} from '@/lib/table/export-stream'
import { checkAccess } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  rateLimitHeaders,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2TableExportAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * GET /api/v2/tables/[tableId]/export — Stream the whole table as a file.
 *
 * The one v2 endpoint whose success body is NOT the `{ data }` envelope: the
 * body is the file. Rate-limit headers are attached by hand for the same
 * reason. Errors before the first byte still use the canonical envelope; once
 * the stream has started a failure can only tear the connection down, which is
 * why large tables belong on the async export.
 */
export const GET = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-export')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2ExportTableContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId, format } = parsed.data.query

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const access = await checkAccess(tableId, userId, 'read')
    // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
    if (!access.ok || access.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const { table } = access

    // Audit BEFORE streaming: rows leave incrementally, so a mid-stream failure
    // has still exfiltrated whatever was written.
    recordAudit({
      workspaceId: table.workspaceId ?? null,
      actorId: userId,
      action: AuditAction.TABLE_EXPORTED,
      resourceType: AuditResourceType.TABLE,
      resourceId: tableId,
      resourceName: table.name,
      description: `Exported table "${table.name}" as ${format.toUpperCase()}`,
      metadata: { format, rowCount: table.rowCount },
      request,
    })
    captureServerEvent(
      userId,
      'table_exported',
      { table_id: tableId, workspace_id: workspaceId },
      { groups: { workspace: workspaceId } }
    )

    return new NextResponse(createTableExportStream(table, format, requestId), {
      status: 200,
      headers: {
        ...rateLimitHeaders(rateLimit),
        'Content-Type': exportContentType(format),
        'Content-Disposition': `attachment; filename="${sanitizeExportFilename(table.name)}.${format}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error exporting table`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
