import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { importIntoTableAsyncContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runTableImport } from '@/lib/table/import-runner'
import { markTableImporting } from '@/lib/table/service'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableImportIntoAsync')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ tableId: string }>
}

export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()

  const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const userId = authResult.userId

  const parsed = await parseRequest(importIntoTableAsyncContract, request, { params })
  if (!parsed.success) return parsed.response
  const { tableId } = parsed.data.params
  const { workspaceId, fileKey, fileName, mode, mapping, createColumns } = parsed.data.body

  const access = await checkAccess(tableId, userId, 'write')
  if (!access.ok) return accessError(access, requestId, tableId)
  const { table } = access

  if (table.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
  }
  // The fileKey is client-supplied — ensure it points at this workspace's storage prefix so a
  // caller can't import another workspace's uploaded object.
  if (!fileKey.startsWith(`workspace/${workspaceId}/`)) {
    return NextResponse.json({ error: 'Invalid file key for workspace' }, { status: 400 })
  }
  if (table.archivedAt) {
    return NextResponse.json({ error: 'Cannot import into an archived table' }, { status: 400 })
  }

  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext !== 'csv' && ext !== 'tsv') {
    return NextResponse.json({ error: 'Only CSV and TSV files are supported' }, { status: 400 })
  }
  const delimiter = ext === 'tsv' ? '\t' : ','

  // Atomically claim the table — the single concurrency gate. If another import already holds it,
  // this returns false (no overlapping workers writing colliding row positions).
  const importId = generateId()
  const claimed = await markTableImporting(tableId, importId)
  if (!claimed) {
    return NextResponse.json(
      { error: 'An import is already in progress for this table' },
      { status: 409 }
    )
  }

  runDetached('table-import', () =>
    runTableImport({
      importId,
      tableId,
      workspaceId,
      userId,
      fileKey,
      fileName,
      delimiter,
      mode,
      mapping,
      createColumns,
    })
  )

  logger.info(`[${requestId}] Async CSV import into existing table started`, {
    tableId,
    importId,
    mode,
    fileName,
  })
  return NextResponse.json({ success: true, data: { tableId, importId } })
})
