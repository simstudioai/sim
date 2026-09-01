import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { importTableAsyncContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { capabilityGovernedAuthUserId, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { findActiveFolder } from '@/lib/folders/queries'
import { isWorkspaceCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
import { capabilityRefusalResponse } from '@/lib/permission-groups/capability-response'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  createTable,
  deleteTable,
  getWorkspaceTableLimits,
  listTables,
  releaseJobClaim,
  sanitizeName,
  TABLE_LIMITS,
} from '@/lib/table'
import { runTableImport, type TableImportPayload } from '@/lib/table/import-runner'
import { getUserSettings } from '@/lib/users/queries'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { orchestrationErrorResponse } from '@/app/api/table/utils'

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
  const { workspaceId, fileKey, fileName, folderId, deleteSourceFile, timezone } = parsed.data.body

  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (permission !== 'write' && permission !== 'admin') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  /**
   * permission-group-enforced: tables.create — raw route that queries directly
   * and predates the operation boundary. An import always ends in a new table,
   * so it is creation, not ordinary use. `tables.create` subsumes `tables.use`:
   * its rule is denied by `disableTableCreation` OR `hideTablesTab`, so gating
   * on it still refuses a group that hides Tables entirely. Keyed to the
   * governed subject, which names nobody for an internal-JWT executor call —
   * the same rule the synchronous `import-csv` route applies. Not re-read before
   * `createTable` below: `resolvePermissionGroupConfig` is memoized per request
   * (`withPermissionGroupScope`), so a second call in this handler returns the
   * promise this one started and could not observe a revocation.
   */
  const governedUserId = capabilityGovernedAuthUserId(authResult)
  if (
    governedUserId &&
    (await isWorkspaceCapabilityWithheld(governedUserId, workspaceId, 'tables.create'))
  ) {
    return capabilityRefusalResponse('tables.create')
  }
  // The fileKey is client-supplied — ensure it points at this workspace's storage prefix so a
  // caller can't import another workspace's uploaded object.
  if (!fileKey.startsWith(`workspace/${workspaceId}/`)) {
    return NextResponse.json({ error: 'Invalid file key for workspace' }, { status: 400 })
  }

  // Scoped to `resourceType: 'table'` so a folder from another resource's tree
  // can't file the imported table where Tables never lists it.
  if (folderId && !(await findActiveFolder(folderId, workspaceId, 'table'))) {
    return NextResponse.json({ error: 'Folder not found in this workspace' }, { status: 404 })
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
        folderId,
        userId,
        maxTables: planLimits.maxTables,
        jobStatus: 'running',
        jobType: 'import',
        jobId: importId,
      },
      requestId
    )
  } catch (error) {
    const classified = orchestrationErrorResponse(error)
    if (classified) return classified
    throw error
  }

  const importPayload: TableImportPayload = {
    importId,
    tableId: table.id,
    workspaceId,
    userId,
    fileKey,
    fileName,
    delimiter,
    mode: 'create',
    deleteSourceFile,
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
        tags: [`tableId:${table.id}`, `jobId:${importId}`],
        region: await resolveTriggerRegion(),
      })
    } catch (error) {
      // A failed dispatch must not leave a ghost `running` job holding the
      // table's one-write-job slot — nor, in create mode, the placeholder
      // table itself: the user never saw it, so archive it back out of the
      // workspace (no hard-delete surface exists; archived is invisible).
      await releaseJobClaim(table.id, importId).catch(() => {})
      await deleteTable(table.id, requestId).catch(() => {})
      throw error
    }
  } else {
    runDetached('table-import', () => runTableImport(importPayload))
  }

  captureServerEvent(
    userId,
    'table_import_started',
    {
      table_id: table.id,
      workspace_id: workspaceId,
      import_id: importId,
      file_type: ext,
    },
    { groups: { workspace: workspaceId } }
  )

  logger.info(`[${requestId}] Async CSV import started`, { tableId: table.id, importId, fileName })
  return NextResponse.json({ success: true, data: { tableId: table.id, importId } })
})
