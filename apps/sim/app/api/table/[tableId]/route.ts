import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { getTableQuerySchema, updateTableContract } from '@/lib/api/contracts/tables'
import { isZodError, parseRequest, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  deleteTable,
  getTableById,
  renameTable,
  TableConflictError,
  type TableSchema,
  updateTableLocks,
} from '@/lib/table'
import { getWorkspaceTableLimits } from '@/lib/table/billing'
import { signalTableSchemaChanged } from '@/lib/table/events'
import { TABLE_LOCK_FLAGS, TABLE_LOCK_KINDS } from '@/lib/table/types'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import {
  accessError,
  checkAccess,
  normalizeColumn,
  tableLockErrorResponse,
} from '@/app/api/table/utils'

const logger = createLogger('TableDetailAPI')

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/** GET /api/table/[tableId] - Retrieves a single table's details. */
export const GET = withRouteHandler(async (request: NextRequest, { params }: TableRouteParams) => {
  const requestId = generateRequestId()
  const { tableId } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized table access attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const validated = getTableQuerySchema.parse({
      workspaceId: searchParams.get('workspaceId'),
    })

    const result = await checkAccess(tableId, authResult.userId, 'read')
    if (!result.ok) return accessError(result, requestId, tableId)

    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    logger.info(`[${requestId}] Retrieved table ${tableId} for user ${authResult.userId}`)

    const schemaData = table.schema as TableSchema

    // Source the row cap from the workspace's live plan, not the value stored on
    // the table at creation time (which goes stale when the plan changes).
    const { maxRowsPerTable } = await getWorkspaceTableLimits(table.workspaceId)

    return NextResponse.json({
      success: true,
      data: {
        table: {
          id: table.id,
          name: table.name,
          description: table.description,
          schema: {
            columns: schemaData.columns.map(normalizeColumn),
            ...(schemaData.workflowGroups ? { workflowGroups: schemaData.workflowGroups } : {}),
          },
          metadata: table.metadata ?? null,
          rowCount: table.rowCount,
          maxRows: maxRowsPerTable,
          locks: table.locks,
          createdAt:
            table.createdAt instanceof Date
              ? table.createdAt.toISOString()
              : String(table.createdAt),
          updatedAt:
            table.updatedAt instanceof Date
              ? table.updatedAt.toISOString()
              : String(table.updatedAt),
          jobStatus: table.jobStatus ?? null,
          jobId: table.jobId ?? null,
          jobType: table.jobType ?? null,
          jobError: table.jobError ?? null,
          jobRowsProcessed: table.jobRowsProcessed ?? 0,
        },
      },
    })
  } catch (error) {
    if (isZodError(error)) {
      return validationErrorResponse(error)
    }

    logger.error(`[${requestId}] Error getting table:`, error)
    return NextResponse.json({ error: 'Failed to get table' }, { status: 500 })
  }
})

/** PATCH /api/table/[tableId] - Renames a table. */
export const PATCH = withRouteHandler(
  async (request: NextRequest, { params }: TableRouteParams) => {
    const requestId = generateRequestId()

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        logger.warn(`[${requestId}] Unauthorized table rename attempt`)
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const parsed = await parseRequest(
        updateTableContract,
        request,
        { params },
        {
          validationErrorResponse: (error) => validationErrorResponse(error),
        }
      )
      if (!parsed.success) return parsed.response

      const { tableId } = parsed.data.params
      const validated = parsed.data.body

      // `write` is the floor for either operation; a `locks` change additionally
      // requires `admin` (checked below), matching the workflow-lock precedent.
      const result = await checkAccess(tableId, authResult.userId, 'write')
      if (!result.ok) return accessError(result, requestId, tableId)

      const { table } = result

      if (table.workspaceId !== validated.workspaceId) {
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      if (validated.locks !== undefined) {
        // With the flag off you may still CLEAR locks — otherwise flipping the
        // kill switch would strand an already-locked table with no way to
        // unlock it, while enforcement of those stored locks keeps running.
        // Only a lock actually transitioning off→on needs the feature enabled;
        // comparing against the stored state (rather than "every value is
        // false") is what lets the settings UI, which always submits the full
        // four-flag draft, clear one lock while another stays on.
        const enablesALock = TABLE_LOCK_KINDS.some((kind) => {
          const flag = TABLE_LOCK_FLAGS[kind]
          return validated.locks?.[flag] === true && !table.locks[flag]
        })
        if (enablesALock) {
          // Resolve with the same context the page uses to decide whether to
          // show the panel — keyed on the workspace's host organization, not
          // the viewer's active one. Without it an org- or user-targeted
          // rollout would open the panel and then 403 on save. Looked up only
          // on the enabling path, so an unlock never pays for it.
          const workspace = await getWorkspaceWithOwner(table.workspaceId)
          const enabled = await isFeatureEnabled('table-locks', {
            userId: authResult.userId,
            orgId: workspace?.organizationId ?? undefined,
          })
          if (!enabled) {
            return NextResponse.json({ error: 'Table locks are not enabled' }, { status: 403 })
          }
        }
        const adminResult = await checkAccess(tableId, authResult.userId, 'admin')
        if (!adminResult.ok) {
          return NextResponse.json(
            { error: 'Admin access required to change table locks' },
            { status: 403 }
          )
        }
        await updateTableLocks(tableId, validated.locks, authResult.userId, requestId, request)
      }

      if (validated.name !== undefined) {
        await renameTable(tableId, validated.name, requestId, authResult.userId)
        // Live-collab: tell open viewers the definition changed so they refetch.
        signalTableSchemaChanged(tableId)
      }

      // Re-read so the response reflects both a rename and a lock change.
      const updated = await getTableById(tableId)
      if (!updated) {
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        data: { table: updated },
      })
    } catch (error) {
      const lockError = tableLockErrorResponse(error)
      if (lockError) return lockError

      if (error instanceof TableConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }

      logger.error(`[${requestId}] Error updating table:`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to update table') },
        { status: 500 }
      )
    }
  }
)

/** DELETE /api/table/[tableId] - Archives a table. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: TableRouteParams) => {
    const requestId = generateRequestId()
    const { tableId } = await params

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        logger.warn(`[${requestId}] Unauthorized table delete attempt`)
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const { searchParams } = new URL(request.url)
      const validated = getTableQuerySchema.parse({
        workspaceId: searchParams.get('workspaceId'),
      })

      const result = await checkAccess(tableId, authResult.userId, 'write')
      if (!result.ok) return accessError(result, requestId, tableId)

      const { table } = result

      if (table.workspaceId !== validated.workspaceId) {
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      await deleteTable(tableId, requestId, authResult.userId)

      captureServerEvent(
        authResult.userId,
        'table_deleted',
        { table_id: tableId, workspace_id: table.workspaceId },
        { groups: { workspace: table.workspaceId } }
      )

      return NextResponse.json({
        success: true,
        data: {
          message: 'Table archived successfully',
        },
      })
    } catch (error) {
      const lockError = tableLockErrorResponse(error)
      if (lockError) return lockError
      if (isZodError(error)) {
        return validationErrorResponse(error)
      }

      logger.error(`[${requestId}] Error deleting table:`, error)
      return NextResponse.json({ error: 'Failed to delete table' }, { status: 500 })
    }
  }
)
