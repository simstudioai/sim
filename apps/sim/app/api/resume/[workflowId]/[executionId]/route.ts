import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'

const logger = createLogger('WorkflowResumeExecutionAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ workflowId: string; executionId: string }>
  }
) {
  const { workflowId, executionId } = await params

  const access = await validateWorkflowAccess(request, workflowId, false)
  if (access.error) {
    return NextResponse.json({ error: access.error.message }, { status: access.error.status })
  }

  try {
    const detail = await PauseResumeManager.getPausedExecutionDetail({
      workflowId,
      executionId,
    })

    if (!detail) {
      return NextResponse.json({ error: 'Paused execution not found' }, { status: 404 })
    }

    return NextResponse.json(detail)
  } catch (error: any) {
    logger.error('Failed to load paused execution detail', {
      workflowId,
      executionId,
      error,
    })
    return NextResponse.json(
      { error: error?.message || 'Failed to load paused execution detail' },
      { status: 500 }
    )
  }
}
