import { type NextRequest, NextResponse } from 'next/server'
import {
  cancelTableExportResourceContract,
  getTableExportResourceContract,
} from '@/lib/api/contracts/table-transfers'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  cancelTableExportResource,
  requireTableExport,
  toV2TableExport,
} from '@/lib/table/orchestration/export-resource'
import { accessError, checkAccess, orchestrationErrorResponse } from '@/app/api/table/utils'

interface ExportRouteParams {
  params: Promise<{ exportId: string }>
}

async function authorizedExport(exportId: string, workspaceId: string, userId: string) {
  const record = await requireTableExport(exportId, workspaceId)
  const access = await checkAccess(record.tableId, userId, 'read')
  return { record, access }
}

export const GET = withRouteHandler(async (request: NextRequest, context: ExportRouteParams) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const parsed = await parseRequest(getTableExportResourceContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const { record, access } = await authorizedExport(
      parsed.data.params.exportId,
      parsed.data.query.workspaceId,
      auth.userId
    )
    if (!access.ok) return accessError(access, 'table-export')
    return NextResponse.json({ data: toV2TableExport(record) })
  } catch (error) {
    const classified = orchestrationErrorResponse(error)
    if (classified) return classified
    throw error
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: ExportRouteParams) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const parsed = await parseRequest(cancelTableExportResourceContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const { record, access } = await authorizedExport(
      parsed.data.params.exportId,
      parsed.data.query.workspaceId,
      auth.userId
    )
    if (!access.ok) return accessError(access, 'table-export')
    return NextResponse.json({ data: toV2TableExport(await cancelTableExportResource(record)) })
  } catch (error) {
    const classified = orchestrationErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
