import { type NextRequest, NextResponse } from 'next/server'
import { PauseResumeManager } from '@/lib/workflows/executor/pause-resume-manager'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: { id: string }
  }
) {
  const workflowId = params.id

  const access = await validateWorkflowAccess(request, workflowId, false)
  if (access.error) {
    return NextResponse.json({ error: access.error.message }, { status: access.error.status })
  }

  const statusFilter = request.nextUrl.searchParams.get('status') || undefined

  const pausedExecutions = await PauseResumeManager.listPausedExecutions({
    workflowId,
    status: statusFilter,
  })

  return NextResponse.json({ pausedExecutions })
}
