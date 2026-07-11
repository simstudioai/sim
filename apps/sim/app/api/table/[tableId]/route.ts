import { createLogger } from '@sim/logger'
import { ResourceLockedError } from '@sim/platform-authz/resource-lock'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { getTableQuerySchema, renameTableContract } from '@/lib/api/contracts/tables'
import { isZodError, parseRequest, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  deleteTable,
  renameTable,
  TableConflictError,
  TableInvalidFolderError,
  type TableSchema,
} from '@/lib/table'
import { getWorkspaceTableLimits } from '@/lib/table/billing'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { accessError, checkAccess, normalizeColumn } from '@/app/api/table/utils'

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
          folderId: table.folderId,
          locked: table.locked,
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
        renameTableContract,
        request,
        { params },
        {
          validationErrorResponse: (error) => validationErrorResponse(error),
        }
      )
      if (!parsed.success) return parsed.response

      const { tableId } = parsed.data.params
      const validated = parsed.data.body

      const result = await checkAccess(tableId, authResult.userId, 'write')
      if (!result.ok) return accessError(result, requestId, tableId)

      const { table } = result

      if (table.workspaceId !== validated.workspaceId) {
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
      }

      if (validated.locked !== undefined && validated.locked !== table.locked) {
        const workspacePermission = await getUserEntityPermissions(
          authResult.userId,
          'workspace',
          table.workspaceId
        )
        if (workspacePermission !== 'admin') {
          return NextResponse.json(
            { error: 'Admin access required to lock tables' },
            { status: 403 }
          )
        }
      }

      const isLockOnlyUpdate =
        validated.name === table.name &&
        (validated.folderId === undefined || validated.folderId === (table.folderId ?? null))

      const updated = await renameTable(
        tableId,
        validated.name,
        requestId,
        authResult.userId,
        validated.folderId,
        validated.locked,
        isLockOnlyUpdate
      )

      return NextResponse.json({
        success: true,
        data: { table: updated },
      })
    } catch (error) {
      if (error instanceof ResourceLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      if (error instanceof TableConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }
      if (error instanceof TableInvalidFolderError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      logger.error(`[${requestId}] Error renaming table:`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to rename table') },
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
      if (isZodError(error)) {
        return validationErrorResponse(error)
      }
      if (error instanceof ResourceLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      logger.error(`[${requestId}] Error deleting table:`, error)
      return NextResponse.json({ error: 'Failed to delete table' }, { status: 500 })
    }
  }
)
