import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { markExecutionCancelled } from '@/lib/execution/cancellation'
import { createExecutionEventWriter, setExecutionMeta } from '@/lib/execution/event-buffer'
import { abortManualExecution } from '@/lib/execution/manual-cancellation'
import { captureServerEvent } from '@/lib/posthog/server'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
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
    let pausedCancelled = false
    try {
      pausedCancelled = await PauseResumeManager.cancelPausedExecution(executionId)
    } catch (error) {
      logger.warn('Failed to cancel paused execution in database', { executionId, error })
    }

    if (cancellation.durablyRecorded) {
      logger.info('Execution marked as cancelled in Redis', { executionId })
    } else if (locallyAborted) {
      logger.info('Execution cancelled via local in-process fallback', { executionId })
    } else if (pausedCancelled) {
      logger.info('Paused execution cancelled directly in database', { executionId })
      void setExecutionMeta(executionId, { status: 'cancelled', workflowId }).catch(() => {})
      const writer = createExecutionEventWriter(executionId)
      void writer
        .write({
          type: 'execution:cancelled',
          timestamp: new Date().toISOString(),
          executionId,
          workflowId,
          data: { duration: 0 },
        })
        .then(() => writer.close())
        .catch(() => {})
    } else {
      logger.warn('Execution cancellation was not durably recorded', {
        executionId,
        reason: cancellation.reason,
      })
    }

    const success = cancellation.durablyRecorded || locallyAborted || pausedCancelled

    if (success) {
      const workspaceId = workflowAuthorization.workflow?.workspaceId
      captureServerEvent(
        auth.userId,
        'workflow_execution_cancelled',
        { workflow_id: workflowId, workspace_id: workspaceId ?? '' },
        workspaceId ? { groups: { workspace: workspaceId } } : undefined
      )
    }

    return NextResponse.json({
      success,
      executionId,
      redisAvailable: cancellation.reason !== 'redis_unavailable',
      durablyRecorded: cancellation.durablyRecorded,
      locallyAborted,
      pausedCancelled,
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
