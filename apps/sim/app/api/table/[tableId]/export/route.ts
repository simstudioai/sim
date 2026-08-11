import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type NextRequest, NextResponse } from 'next/server'
import { tableExportFormatSchema, tableIdParamsSchema } from '@/lib/api/contracts/tables'
import { getValidationErrorMessage } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  createTableExportStream,
  exportContentType,
  sanitizeExportFilename,
} from '@/lib/table/export-stream'
import { accessError, checkAccess } from '@/app/api/table/utils'

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/** GET /api/table/[tableId]/export - Streams the full table contents as CSV or JSON. */
export const GET = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  const { tableId } = tableIdParamsSchema.parse(await params)

  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const userId = auth.userId

  const { searchParams } = new URL(request.url)
  const formatValidation = tableExportFormatSchema.safeParse(
    searchParams.get('format') ?? undefined
  )
  if (!formatValidation.success) {
    return NextResponse.json(
      { error: getValidationErrorMessage(formatValidation.error) },
      { status: 400 }
    )
  }
  const format = formatValidation.data

  const access = await checkAccess(tableId, auth.userId, 'read')
  if (!access.ok) return accessError(access, requestId, tableId)
  const { table } = access

  // Audit before streaming: rows leave incrementally, so a mid-stream failure still exfiltrates partial data.
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
  if (table.workspaceId) {
    captureServerEvent(
      userId,
      'table_exported',
      { table_id: tableId, workspace_id: table.workspaceId },
      { groups: { workspace: table.workspaceId } }
    )
  }

  return new NextResponse(createTableExportStream(table, format, requestId), {
    status: 200,
    headers: {
      'Content-Type': exportContentType(format),
      'Content-Disposition': `attachment; filename="${sanitizeExportFilename(table.name)}.${format}"`,
      'Cache-Control': 'no-store',
    },
  })
})
