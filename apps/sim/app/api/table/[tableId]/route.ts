import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  getTableContract,
  getTableQuerySchema,
  updateTableContract,
} from '@/lib/api/contracts/tables'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { isZodError, parseRequest, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { findActiveFolder } from '@/lib/folders/queries'
import { getTableById, TableConflictError } from '@/lib/table'
import { internalTableErrorPolicies, internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { tableOperations } from '@/lib/table/application/operations'
import { readTableDetailsUseCase } from '@/lib/table/application/tables'
import { signalTableSchemaChanged } from '@/lib/table/events'
import {
  performDeleteTable,
  performMoveTableToFolder,
  performRenameTable,
  performUpdateTableLocks,
} from '@/lib/table/orchestration'
import { normalizeColumn, toWireTimestamp } from '@/lib/table/wire'
import {
  accessError,
  checkAccess,
  orchestrationOutcomeErrorResponse,
  tableLockErrorResponse,
} from '@/app/api/table/utils'

const logger = createLogger('TableDetailAPI')

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/** GET /api/table/[tableId] - Retrieves a single table's details. */
export const GET = defineInternalJsonRoute({
  contract: getTableContract,
  operation: tableOperations.read,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal table detail behavior',
  }),
  errorPolicy: {
    ...internalTableErrorPolicies.concealTableAuthorization,
    unhandled: () => internalErrorResponse(500, { error: 'Failed to get table' }),
  },
  mapInput: ({ params, query }, { principal }) => ({
    tableId: params.tableId,
    workspaceId: principal.kind === 'delegated' ? principal.workspaceId : query.workspaceId,
  }),
  useCase: readTableDetailsUseCase,
  present: ({ table, maxRows }) => ({
    success: true as const,
    data: {
      table: {
        id: table.id,
        name: table.name,
        description: table.description,
        schema: {
          columns: table.schema.columns.map(normalizeColumn),
          ...(table.schema.workflowGroups ? { workflowGroups: table.schema.workflowGroups } : {}),
        },
        metadata: table.metadata ?? null,
        rowCount: table.rowCount,
        maxRows,
        folderId: table.folderId ?? null,
        locks: table.locks,
        workspaceId: table.workspaceId,
        createdBy: table.createdBy,
        createdAt: toWireTimestamp(table.createdAt),
        updatedAt: toWireTimestamp(table.updatedAt),
        jobStatus: table.jobStatus ?? null,
        jobId: table.jobId ?? null,
        jobType: table.jobType ?? null,
        jobError: table.jobError ?? null,
        jobRowsProcessed: table.jobRowsProcessed ?? 0,
      },
    },
  }),
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
        const adminResult = await checkAccess(tableId, authResult.userId, 'admin')
        if (!adminResult.ok) {
          return NextResponse.json(
            { error: 'Admin access required to change table locks' },
            { status: 403 }
          )
        }
        const lockOutcome = await performUpdateTableLocks({
          tableId,
          partial: validated.locks,
          userId: authResult.userId,
          requestId,
          request,
        })
        if (!lockOutcome.success) {
          return orchestrationOutcomeErrorResponse(lockOutcome, 'Failed to update table locks')
        }
      }

      if (validated.name !== undefined) {
        const renameOutcome = await performRenameTable({
          table,
          newName: validated.name,
          userId: authResult.userId,
          requestId,
          request,
        })
        if (!renameOutcome.success) {
          return orchestrationOutcomeErrorResponse(renameOutcome, 'Failed to rename table')
        }
      }

      if (validated.folderId !== undefined) {
        // Scoped to `resourceType: 'table'` so a folder id from another resource's
        // tree can't be used to file the table somewhere Tables never lists.
        if (
          validated.folderId !== null &&
          !(await findActiveFolder(validated.folderId, table.workspaceId, 'table'))
        ) {
          return NextResponse.json({ error: 'Folder not found in this workspace' }, { status: 404 })
        }
        // The move re-asserts workspace and active state, so a miss means the table was
        // archived between `checkAccess` and the write. That is a 404, not a server fault.
        const moveOutcome = await performMoveTableToFolder({
          table,
          folderId: validated.folderId,
          userId: authResult.userId,
          requestId,
          request,
        })
        if (!moveOutcome.success) {
          return orchestrationOutcomeErrorResponse(
            moveOutcome.errorCode === 'not_found'
              ? { ...moveOutcome, error: 'Table not found' }
              : moveOutcome,
            'Failed to move table'
          )
        }
      }

      // Live-collab: tell open viewers the definition changed so they refetch.
      signalTableSchemaChanged(tableId)

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

      const outcome = await performDeleteTable({
        table,
        userId: authResult.userId,
        requestId,
        request,
      })
      if (!outcome.success) {
        return orchestrationOutcomeErrorResponse(outcome, 'Failed to delete table')
      }

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
