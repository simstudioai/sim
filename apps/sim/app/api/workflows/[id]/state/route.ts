import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { putWorkflowNormalizedStateContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { saveWorkflowNormalizedState } from '@/lib/workflows/persistence/save-normalized-state'

const logger = createLogger('WorkflowStateAPI')

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
        logger.warn(`Unauthorized state update attempt for workflow ${workflowId}`)
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
      logger.info(`Successfully saved workflow ${workflowId} state in ${elapsed}ms`)

      return NextResponse.json({ success: true, warnings: result.warnings }, { status: 200 })
    } catch (error: any) {
      const elapsed = Date.now() - startTime
      logger.error(`Error saving workflow ${workflowId} state after ${elapsed}ms`, error)

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
