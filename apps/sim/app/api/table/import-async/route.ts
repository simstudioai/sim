import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { importTableAsyncContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createTable,
  getWorkspaceTableLimits,
  listTables,
  sanitizeName,
  TABLE_LIMITS,
  TableConflictError,
} from '@/lib/table'
import { runTableImport } from '@/lib/table/import-runner'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('TableImportAsync')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const userId = authResult.userId

  const parsed = await parseRequest(importTableAsyncContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId, fileKey, fileName } = parsed.data.body

  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (permission !== 'write' && permission !== 'admin') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  // The fileKey is client-supplied — ensure it points at this workspace's storage prefix so a
  // caller can't import another workspace's uploaded object.
  if (!fileKey.startsWith(`workspace/${workspaceId}/`)) {
    return NextResponse.json({ error: 'Invalid file key for workspace' }, { status: 400 })
  }

  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext !== 'csv' && ext !== 'tsv') {
    return NextResponse.json({ error: 'Only CSV and TSV files are supported' }, { status: 400 })
  }
  const delimiter = ext === 'tsv' ? '\t' : ','

  const planLimits = await getWorkspaceTableLimits(workspaceId)
  const baseName = sanitizeName(fileName.replace(/\.[^.]+$/, ''), 'imported_table').slice(
    0,
    TABLE_LIMITS.MAX_TABLE_NAME_LENGTH
  )
  // Re-importing the same file shouldn't fail on a name collision — pick the next free
  // `name_2`, `name_3`, … (matching how "New table" auto-names), keeping under the cap.
  const existingNames = new Set(
    (await listTables(workspaceId, { scope: 'all' })).map((t) => t.name.toLowerCase())
  )
  let tableName = baseName
  for (let n = 2; existingNames.has(tableName.toLowerCase()); n++) {
    const suffix = `_${n}`
    tableName = `${baseName.slice(0, TABLE_LIMITS.MAX_TABLE_NAME_LENGTH - suffix.length)}${suffix}`
  }
  const importId = generateId()

  // Placeholder schema satisfies createTable's validation; the import worker infers the
  // real columns from the file and overwrites it before any rows become visible.
  let table: Awaited<ReturnType<typeof createTable>>
  try {
    table = await createTable(
      {
        name: tableName,
        description: `Imported from ${fileName}`,
        schema: { columns: [{ name: 'column_1', type: 'string' }] },
        workspaceId,
        userId,
        maxRows: planLimits.maxRowsPerTable,
        maxTables: planLimits.maxTables,
        importStatus: 'importing',
        importId,
      },
      requestId
    )
  } catch (error) {
    if (error instanceof TableConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.includes('maximum table limit')) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  runDetached('table-import', () =>
    runTableImport({
      importId,
      tableId: table.id,
      workspaceId,
      userId,
      fileKey,
      fileName,
      delimiter,
      mode: 'create',
    })
  )

  logger.info(`[${requestId}] Async CSV import started`, { tableId: table.id, importId, fileName })
  return NextResponse.json({ success: true, data: { tableId: table.id, importId } })
})
