import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { toError } from '@sim/utils/errors'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { putWorkflowNormalizedStateContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { saveWorkflowNormalizedState } from '@/lib/workflows/persistence/save-normalized-state'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

const logger = createLogger('WorkflowStateAPI')

/**
 * GET /api/workflows/[id]/state
 * Fetch the current workflow state from normalized tables.
 * Used by the client after server-side edits (edit_workflow) to stay in sync.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: workflowId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: auth.userId,
        action: 'read',
      })
      if (!authorization.allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const snapshot = await db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
        const [normalized, [workflowRecord]] = await Promise.all([
          loadWorkflowFromNormalizedTables(workflowId, tx),
          tx
            .select({ variables: workflow.variables })
            .from(workflow)
            .where(eq(workflow.id, workflowId))
            .limit(1),
        ])
        return { normalized, variables: workflowRecord?.variables }
      })

      if (!snapshot.normalized) {
        return NextResponse.json({ error: 'Workflow state not found' }, { status: 404 })
      }

      // Stamp `workflowId` from the path param on each variable so the
      // global client-side variables store can filter by workflow without
      // requiring clients to thread the path param through. The read
      // contract requires this server-stamped field.
      const persistedVariables =
        (snapshot.variables as Record<string, Record<string, unknown>>) || {}
      const variables: Record<string, Record<string, unknown>> = {}
      for (const [variableId, variable] of Object.entries(persistedVariables)) {
        if (variable && typeof variable === 'object') {
          variables[variableId] = { ...variable, workflowId }
        }
      }

      return NextResponse.json({
        blocks: snapshot.normalized.blocks,
        edges: snapshot.normalized.edges,
        loops: snapshot.normalized.loops || {},
        parallels: snapshot.normalized.parallels || {},
        variables,
      })
    } catch (error) {
      logger.error('Failed to fetch workflow state', {
        workflowId,
        error: toError(error).message,
      })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * PUT /api/workflows/[id]/state
 * Save complete workflow state to normalized database tables
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const startTime = Date.now()
    const { id: workflowId } = await context.params

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized state update attempt for workflow ${workflowId}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const parsed = await parseRequest(putWorkflowNormalizedStateContract, request, context)
      if (!parsed.success) return parsed.response

      const result = await saveWorkflowNormalizedState({
        requestId,
        workflowId,
        userId,
        state: parsed.data.body,
      })

      if (!result.success) {
        return NextResponse.json(
          {
            error: result.error,
            ...(result.details !== undefined ? { details: result.details } : {}),
          },
          { status: result.status }
        )
      }

      const elapsed = Date.now() - startTime
      logger.info(`[${requestId}] Successfully saved workflow ${workflowId} state in ${elapsed}ms`)

      return NextResponse.json({ success: true, warnings: result.warnings }, { status: 200 })
    } catch (error: any) {
      const elapsed = Date.now() - startTime
      logger.error(
        `[${requestId}] Error saving workflow ${workflowId} state after ${elapsed}ms`,
        error
      )

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
