import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { markExecutionCancelled } from '@/lib/execution/cancellation'
import { abortManualExecution } from '@/lib/execution/manual-cancellation'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'

const logger = createLogger('CancelExecutionAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  const { id: workflowId, executionId } = await params

  try {
    const auth = await checkHybridAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const workflowAuthorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId: auth.userId,
      action: 'write',
    })
    if (!workflowAuthorization.allowed) {
      return NextResponse.json(
        { error: workflowAuthorization.message || 'Access denied' },
        { status: workflowAuthorization.status }
      )
    }

    if (
      auth.apiKeyType === 'workspace' &&
      workflowAuthorization.workflow?.workspaceId !== auth.workspaceId
    ) {
      return NextResponse.json(
        { error: 'API key is not authorized for this workspace' },
        { status: 403 }
      )
    }

    logger.info('Cancel execution requested', { workflowId, executionId, userId: auth.userId })

    const cancellation = await markExecutionCancelled(executionId)
    const locallyAborted = abortManualExecution(executionId)

    if (cancellation.durablyRecorded) {
      logger.info('Execution marked as cancelled in Redis', { executionId })
    } else if (locallyAborted) {
      logger.info('Execution cancelled via local in-process fallback', { executionId })
    } else {
      logger.warn('Execution cancellation was not durably recorded', {
        executionId,
        reason: cancellation.reason,
      })
    }

    return NextResponse.json({
      success: cancellation.durablyRecorded || locallyAborted,
      executionId,
      redisAvailable: cancellation.reason !== 'redis_unavailable',
      durablyRecorded: cancellation.durablyRecorded,
      locallyAborted,
      reason: cancellation.reason,
    })
  } catch (error: any) {
    logger.error('Failed to cancel execution', { workflowId, executionId, error: error.message })
    return NextResponse.json(
      { error: error.message || 'Failed to cancel execution' },
      { status: 500 }
    )
  }
}
