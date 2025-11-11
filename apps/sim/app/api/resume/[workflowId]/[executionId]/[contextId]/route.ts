import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
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

  const access = await validateWorkflowAccess(request, workflowId, false)
  if (access.error) {
    return NextResponse.json({ error: access.error.message }, { status: access.error.status })
  }

  const workflow = access.workflow!

  let payload: any = {}
  try {
    payload = await request.json()
  } catch {
    payload = {}
  }

  const resumeInput = payload?.input ?? payload ?? {}
  const userId = workflow.userId ?? ''

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
