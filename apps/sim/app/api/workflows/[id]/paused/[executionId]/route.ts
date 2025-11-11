import { type NextRequest, NextResponse } from 'next/server'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: { id: string; executionId: string }
  }
) {
  const workflowId = params.id
  const executionId = params.executionId

  const access = await validateWorkflowAccess(request, workflowId, false)
  if (access.error) {
    return NextResponse.json({ error: access.error.message }, { status: access.error.status })
  }

  const detail = await PauseResumeManager.getPausedExecutionDetail({
    workflowId,
    executionId,
  })

  if (!detail) {
    return NextResponse.json({ error: 'Paused execution not found' }, { status: 404 })
  }

  return NextResponse.json(detail)
}
