import { type NextRequest, NextResponse } from 'next/server'
import { createTableExportResourceContract } from '@/lib/api/contracts/table-transfers'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createTableExportResource,
  toV2TableExport,
} from '@/lib/table/orchestration/export-resource'
import { accessError, checkAccess, orchestrationErrorResponse } from '@/app/api/table/utils'

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

export const POST = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const parsed = await parseRequest(createTableExportResourceContract, request, context)
  if (!parsed.success) return parsed.response
  const access = await checkAccess(parsed.data.params.tableId, auth.userId, 'read')
  if (!access.ok) return accessError(access, 'table-export')
  if (access.table.workspaceId !== parsed.data.body.workspaceId) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }
  try {
    const record = await createTableExportResource({
      table: access.table,
      format: parsed.data.body.format,
    })
    return NextResponse.json({ data: toV2TableExport(record, true) }, { status: 201 })
  } catch (error) {
    const classified = orchestrationErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
