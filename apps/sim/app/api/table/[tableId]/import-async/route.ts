import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { importIntoTableAsyncContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runTableImport, type TableImportPayload } from '@/lib/table/import-runner'
import { markTableJobRunning, releaseJobClaim } from '@/lib/table/jobs/service'
import { getUserSettings } from '@/lib/users/queries'
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
  const { workspaceId, fileKey, fileName, mode, mapping, createColumns, timezone } =
    parsed.data.body

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

  // Atomically claim the table's job slot — the single concurrency gate. If another job (import
  // or delete) already holds it, this returns false (no overlapping workers).
  const importId = generateId()
  const claimed = await markTableJobRunning(tableId, importId, 'import')
  if (!claimed) {
    return NextResponse.json(
      { error: 'A job is already in progress for this table' },
      { status: 409 }
    )
  }

  const importPayload: TableImportPayload = {
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
    timezone: timezone ?? (await getUserSettings(userId)).timezone ?? 'UTC',
  }
  if (isTriggerDevEnabled) {
    // Trigger.dev runs the import outside the web container, so it survives app deploys.
    try {
      const [{ tableImportTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
        import('@/background/table-import'),
        import('@trigger.dev/sdk'),
        import('@/lib/core/async-jobs/region'),
      ])
      await tasks.trigger<typeof tableImportTask>('table-import', importPayload, {
        tags: [`tableId:${tableId}`, `jobId:${importId}`],
        region: await resolveTriggerRegion(),
      })
    } catch (error) {
      // A failed dispatch must not leave a ghost `running` job holding the
      // table's one-write-job slot until the stale-job janitor fires.
      await releaseJobClaim(tableId, importId).catch(() => {})
      throw error
    }
  } else {
    runDetached('table-import', () => runTableImport(importPayload))
  }

  logger.info(`[${requestId}] Async CSV import into existing table started`, {
    tableId,
    importId,
    mode,
    fileName,
  })
  return NextResponse.json({ success: true, data: { tableId, importId } })
})
