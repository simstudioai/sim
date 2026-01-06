import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'

const logger = createLogger('WorkflowResumeAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ workflowId: string; executionId: string; contextId: string }>
  }
) {
  const { workflowId, executionId, contextId } = await params

  // Allow resume from dashboard without requiring deployment
  const access = await validateWorkflowAccess(request, workflowId, false)
  if (access.error) {
    return NextResponse.json({ error: access.error.message }, { status: access.error.status })
  }

  const workflow = access.workflow

  let payload: Record<string, unknown> = {}
  try {
    payload = await request.json()
  } catch {
    payload = {}
  }

  const resumeInput = payload?.input ?? payload ?? {}
  const userId = workflow.userId ?? ''

  const resumeExecutionId = randomUUID()
  const requestId = generateRequestId()

  logger.info(`[${requestId}] Preprocessing resume execution`, {
    workflowId,
    parentExecutionId: executionId,
    resumeExecutionId,
    userId,
  })

  const preprocessResult = await preprocessExecution({
    workflowId,
    userId,
    triggerType: 'manual', // Resume is a manual trigger
    executionId: resumeExecutionId,
    requestId,
    checkRateLimit: false, // Manual triggers bypass rate limits
    checkDeployment: false, // Resuming existing execution, deployment already checked
    skipUsageLimits: true, // Resume is continuation of authorized execution - don't recheck limits
    workspaceId: workflow.workspaceId || undefined,
    isResumeContext: true, // Enable billing fallback for paused workflow resumes
  })

  if (!preprocessResult.success) {
    logger.warn(`[${requestId}] Preprocessing failed for resume`, {
      workflowId,
      parentExecutionId: executionId,
      error: preprocessResult.error?.message,
      statusCode: preprocessResult.error?.statusCode,
    })

    return NextResponse.json(
      {
        error:
          preprocessResult.error?.message ||
          'Failed to validate resume execution. Please try again.',
      },
      { status: preprocessResult.error?.statusCode || 400 }
    )
  }

  logger.info(`[${requestId}] Preprocessing passed, proceeding with resume`, {
    workflowId,
    parentExecutionId: executionId,
    resumeExecutionId,
    actorUserId: preprocessResult.actorUserId,
  })

  try {
    const enqueueResult = await PauseResumeManager.enqueueOrStartResume({
      executionId,
      contextId,
      resumeInput,
      userId,
    })

    if (enqueueResult.status === 'queued') {
      return NextResponse.json({
        status: 'queued',
        executionId: enqueueResult.resumeExecutionId,
        queuePosition: enqueueResult.queuePosition,
        message: 'Resume queued. It will run after current resumes finish.',
      })
    }

    PauseResumeManager.startResumeExecution({
      resumeEntryId: enqueueResult.resumeEntryId,
      resumeExecutionId: enqueueResult.resumeExecutionId,
      pausedExecution: enqueueResult.pausedExecution,
      contextId: enqueueResult.contextId,
      resumeInput: enqueueResult.resumeInput,
      userId: enqueueResult.userId,
    }).catch((error) => {
      logger.error('Failed to start resume execution', {
        workflowId,
        parentExecutionId: executionId,
        resumeExecutionId: enqueueResult.resumeExecutionId,
        error,
      })
    })

    return NextResponse.json({
      status: 'started',
      executionId: enqueueResult.resumeExecutionId,
      message: 'Resume execution started.',
    })
  } catch (error: any) {
    logger.error('Resume request failed', {
      workflowId,
      executionId,
      contextId,
      error,
    })
    return NextResponse.json(
      { error: error.message || 'Failed to queue resume request' },
      { status: 400 }
    )
  }
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ workflowId: string; executionId: string; contextId: string }>
  }
) {
  const { workflowId, executionId, contextId } = await params

  // Allow access without API key for browser-based UI (same as parent execution endpoint)
  const access = await validateWorkflowAccess(request, workflowId, false)
  if (access.error) {
    return NextResponse.json({ error: access.error.message }, { status: access.error.status })
  }

  const detail = await PauseResumeManager.getPauseContextDetail({
    workflowId,
    executionId,
    contextId,
  })

  if (!detail) {
    return NextResponse.json({ error: 'Pause context not found' }, { status: 404 })
  }

  return NextResponse.json(detail)
}
