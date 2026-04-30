import { type NextRequest, NextResponse } from 'next/server'
import { pausedWorkflowExecutionsContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const parsed = await parseRequest(pausedWorkflowExecutionsContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workflowId } = parsed.data.params

    const access = await validateWorkflowAccess(request, workflowId, false)
    if (access.error) {
      return NextResponse.json({ error: access.error.message }, { status: access.error.status })
    }

    const { status: statusFilter } = parsed.data.query

    const pausedExecutions = await PauseResumeManager.listPausedExecutions({
      workflowId,
      status: statusFilter,
    })

    return NextResponse.json({ pausedExecutions })
  }
)
