import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  getPauseContextDetailContract,
  resumeWorkflowExecutionContextContract,
} from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { AuthType } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { handleResumeExecution } from '@/app/api/resume/resume-handler'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(
  async (
    request: NextRequest,
    context: {
      params: Promise<{ workflowId: string; executionId: string; contextId: string }>
    }
  ) => {
    const { workflowId: requestedWorkflowId } = await context.params
    const access = await validateWorkflowAccess(request, requestedWorkflowId, false)
    if (access.error) {
      return NextResponse.json({ error: access.error.message }, { status: access.error.status })
    }

    const parsed = await parseRequest(resumeWorkflowExecutionContextContract, request, context)
    if (!parsed.success) return parsed.response
    const { workflowId, executionId, contextId } = parsed.data.params

    const workflow = access.workflow
    if (!workflow?.workspaceId) {
      return NextResponse.json({ error: 'Workflow has no associated workspace' }, { status: 500 })
    }
    const userId = access.auth?.userId
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let payload: unknown = {}
    try {
      payload = await request.json()
    } catch {
      payload = {}
    }
    const resumeInput =
      typeof payload === 'object' && payload !== null && 'input' in payload
        ? payload.input
        : (payload ?? {})

    return handleResumeExecution({
      request,
      workflowId,
      executionId,
      contextId,
      workspaceId: workflow.workspaceId,
      userId,
      resumeInput,
      isApiCaller: access.auth?.authType === AuthType.API_KEY,
      pollingSurface: 'legacy',
    })
  }
)

export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: {
      params: Promise<{ workflowId: string; executionId: string; contextId: string }>
    }
  ) => {
    const { workflowId: requestedWorkflowId } = await context.params
    const access = await validateWorkflowAccess(request, requestedWorkflowId, false)
    if (access.error) {
      return NextResponse.json({ error: access.error.message }, { status: access.error.status })
    }

    const parsed = await parseRequest(getPauseContextDetailContract, request, context)
    if (!parsed.success) return parsed.response
    const { workflowId, executionId, contextId } = parsed.data.params

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
)
