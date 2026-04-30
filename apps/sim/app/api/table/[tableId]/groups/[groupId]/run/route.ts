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
import type { RowData, RowExecutionMetadata, RowExecutions, TableRow } from '@/lib/table'
import { areGroupDepsSatisfied } from '@/lib/table/workflow-columns'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRunGroupAPI')

const RunSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
})

interface RouteParams {
  params: Promise<{ tableId: string; groupId: string }>
}

/**
 * POST /api/table/[tableId]/groups/[groupId]/run
 *
 * Manually triggers the workflow group for every eligible row in the table.
 * Each eligible row's `executions[groupId]` is reset to `pending` so the
 * scheduler picks it up and enqueues a per-cell trigger.dev job. Rows whose
 * deps aren't satisfied or whose group is already running are skipped.
 */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  const { tableId, groupId } = await params

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

    const group = (table.schema.workflowGroups ?? []).find((g) => g.id === groupId)
    if (!group) {
      return NextResponse.json({ error: 'Workflow group not found' }, { status: 404 })
    }

    const allRows = await db
      .select({
        id: userTableRows.id,
        position: userTableRows.position,
        data: userTableRows.data,
        executions: userTableRows.executions,
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

    // Only target rows whose deps are satisfied AND whose group isn't running.
    // Force-resetting every row would leave dep-unsatisfied rows stuck `pending`
    // forever (the scheduler's eligibility check filters them out anyway), and
    // would re-issue runs already in flight.
    const eligibleRows = allRows.filter((r) => {
      const tableRow: TableRow = {
        id: r.id,
        data: r.data as RowData,
        executions: (r.executions as RowExecutions) ?? {},
        position: r.position,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }
      const exec = tableRow.executions[groupId]
      if (exec?.status === 'running') return false
      if (exec?.status === 'pending' && exec?.jobId) return false
      try {
        return areGroupDepsSatisfied(group, tableRow)
      } catch {
        return false
      }
    })

    if (eligibleRows.length === 0) {
      return NextResponse.json({ success: true, data: { triggered: 0 } })
    }

    const updates = eligibleRows.map((r) => {
      const pendingExec: RowExecutionMetadata = {
        status: 'pending',
        executionId: generateId(),
        jobId: null,
        workflowId: group.workflowId,
        error: null,
      }
      return {
        rowId: r.id,
        data: {} as RowData,
        executionsPatch: { [groupId]: pendingExec },
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
    logger.error(`run-group failed for ${tableId}/${groupId}:`, error)
    return NextResponse.json({ error: 'Failed to run group' }, { status: 500 })
  }
})
