import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { v2ImportTableAsyncContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runTableImport, type TableImportPayload } from '@/lib/table/import-runner'
import { markTableJobRunning, releaseJobClaim } from '@/lib/table/jobs/service'
import { assertRowDelete, assertRowInsert, assertSchemaMutable } from '@/lib/table/mutation-locks'
import { getUserSettings } from '@/lib/users/queries'
import { checkAccess } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { v2TableAccessError, v2TableLockError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableImportAsyncAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/v2/tables/[tableId]/import-async — Start a background import.
 *
 * The file must already be in the workspace's storage; `fileKey` is
 * client-supplied, so it is checked against the workspace's own prefix — a
 * caller must not be able to import another workspace's uploaded object.
 * Progress is observable through `GET /api/v2/tables/jobs` and the job can be
 * stopped with `POST /job/cancel`.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-import')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2ImportTableAsyncContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId, fileKey, fileName, mode, mapping, createColumns, timezone } =
      parsed.data.body

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const access = await checkAccess(tableId, userId, 'write')
    if (!access.ok) return v2TableAccessError(access)

    const { table } = access
    if (table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }
    if (!fileKey.startsWith(`workspace/${workspaceId}/`)) {
      return v2Error('BAD_REQUEST', 'Invalid file key for workspace')
    }
    if (table.archivedAt) {
      return v2Error('BAD_REQUEST', 'Cannot import into an archived table')
    }

    const extension = fileName.split('.').pop()?.toLowerCase()
    if (extension !== 'csv' && extension !== 'tsv') {
      return v2Error('BAD_REQUEST', 'Only CSV and TSV files are supported')
    }

    // Gate the locks BEFORE claiming the single write-job slot, so a locked
    // table reports 423 here instead of holding the slot and failing inside the
    // worker.
    assertRowInsert(table)
    if (mode === 'replace') assertRowDelete(table)
    if (createColumns && createColumns.length > 0) assertSchemaMutable(table)

    const importId = generateId()
    if (!(await markTableJobRunning(tableId, importId, 'import'))) {
      return v2Error('CONFLICT', 'A job is already in progress for this table')
    }

    const payload: TableImportPayload = {
      importId,
      tableId,
      workspaceId,
      userId,
      fileKey,
      fileName,
      delimiter: extension === 'tsv' ? '\t' : ',',
      mode,
      mapping,
      createColumns,
      timezone: timezone ?? (await getUserSettings(userId)).timezone ?? 'UTC',
    }

    if (isTriggerDevEnabled) {
      // Runs outside the web container, so the import survives app deploys.
      try {
        const [{ tableImportTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
          import('@/background/table-import'),
          import('@trigger.dev/sdk'),
          import('@/lib/core/async-jobs/region'),
        ])
        await tasks.trigger<typeof tableImportTask>('table-import', payload, {
          tags: [`tableId:${tableId}`, `jobId:${importId}`],
          region: await resolveTriggerRegion(),
        })
      } catch (error) {
        // A failed dispatch must not leave a ghost `running` job holding the
        // table's one write-job slot until the stale-job janitor fires.
        await releaseJobClaim(tableId, importId).catch(() => {})
        throw error
      }
    } else {
      runDetached('table-import', () => runTableImport(payload))
    }

    logger.info(`[${requestId}] Async CSV import started`, { tableId, importId, mode, fileName })

    return v2Data({ tableId, importId }, { rateLimit })
  } catch (error) {
    const lockError = v2TableLockError(error)
    if (lockError) return lockError

    logger.error(`[${requestId}] Error starting async import`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
