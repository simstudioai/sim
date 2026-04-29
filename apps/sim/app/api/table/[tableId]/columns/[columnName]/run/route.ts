import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { batchUpdateRows } from '@/lib/table'
import type { RowData, TableRow, WorkflowCellValue } from '@/lib/table'
import { areWorkflowColumnDepsSatisfied } from '@/lib/table/workflow-columns'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRunColumnAPI')

const RunSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
})

interface RouteParams {
  params: Promise<{ tableId: string; columnName: string }>
}

/**
 * POST /api/table/[tableId]/columns/[columnName]/run
 *
 * Manually triggers a workflow column run for every row in the table. Each
 * cell is force-reset to `pending`, which fires the scheduler and enqueues
 * a per-cell trigger.dev job.
 */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  const { tableId, columnName } = await params

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const validated = RunSchema.parse(body)

    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)
    const { table } = result

    if (table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const column = table.schema.columns.find((c) => c.name === columnName)
    if (!column || column.type !== 'workflow' || !column.workflowConfig?.workflowId) {
      return NextResponse.json(
        { error: 'Column is not a configured workflow column' },
        { status: 400 }
      )
    }

    const workflowId = column.workflowConfig.workflowId
    const columnIndex = table.schema.columns.findIndex((c) => c.name === columnName)

    const allRows = await db
      .select({
        id: userTableRows.id,
        position: userTableRows.position,
        data: userTableRows.data,
        createdAt: userTableRows.createdAt,
        updatedAt: userTableRows.updatedAt,
      })
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, validated.workspaceId)
        )
      )
      .orderBy(asc(userTableRows.position))

    if (allRows.length === 0) {
      return NextResponse.json({ success: true, data: { triggered: 0 } })
    }

    // Only target rows whose deps are satisfied AND aren't already running.
    // Forcing every row through `pending` would leave dep-unsatisfied rows
    // stuck pending forever (the scheduler's eligibility predicate filters
    // them out), and would re-issue runs that are already in flight.
    const eligibleRows = allRows.filter((r) => {
      const tableRow: TableRow = {
        id: r.id,
        data: r.data as RowData,
        position: r.position,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }
      const cell = (r.data as RowData)[columnName] as WorkflowCellValue | null | undefined
      if (cell?.status === 'running') return false
      try {
        return areWorkflowColumnDepsSatisfied(column, columnIndex, tableRow, table.schema)
      } catch {
        return false
      }
    })

    if (eligibleRows.length === 0) {
      return NextResponse.json({ success: true, data: { triggered: 0 } })
    }

    const updates = eligibleRows.map((r) => {
      const pendingCell: WorkflowCellValue = {
        executionId: generateId(),
        jobId: null,
        workflowId,
        status: 'pending',
        output: null,
        error: null,
      }
      return {
        rowId: r.id,
        data: { [columnName]: pendingCell as unknown as RowData[string] } as RowData,
      }
    })

    const opResult = await batchUpdateRows(
      {
        tableId,
        updates,
        workspaceId: validated.workspaceId,
      },
      table,
      requestId
    )

    return NextResponse.json({
      success: true,
      data: { triggered: opResult.affectedCount },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    logger.error(`run-column failed for ${tableId}/${columnName}:`, error)
    return NextResponse.json({ error: 'Failed to run column' }, { status: 500 })
  }
})
