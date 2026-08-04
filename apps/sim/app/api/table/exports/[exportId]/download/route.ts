import { type NextRequest, NextResponse } from 'next/server'
import { downloadTableExportResourceContract } from '@/lib/api/contracts/table-transfers'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { requireTableExport, tableExportResult } from '@/lib/table/orchestration/export-resource'
import { generatePresignedDownloadUrl } from '@/lib/uploads/core/storage-service'
import { accessError, checkAccess, orchestrationErrorResponse } from '@/app/api/table/utils'

const DOWNLOAD_TTL_SECONDS = 60 * 60

interface ExportRouteParams {
  params: Promise<{ exportId: string }>
}

export const GET = withRouteHandler(async (request: NextRequest, context: ExportRouteParams) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const parsed = await parseRequest(downloadTableExportResourceContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const record = await requireTableExport(
      parsed.data.params.exportId,
      parsed.data.query.workspaceId
    )
    const access = await checkAccess(record.tableId, auth.userId, 'read')
    if (!access.ok) return accessError(access, 'table-export')
    const result = tableExportResult(record)
    return NextResponse.json({
      data: {
        url: await generatePresignedDownloadUrl(
          result.resultKey,
          'workspace',
          DOWNLOAD_TTL_SECONDS
        ),
        fileName: result.resultKey.split('/').pop() ?? `export.${result.format}`,
        expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
      },
    })
  } catch (error) {
    const classified = orchestrationErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
