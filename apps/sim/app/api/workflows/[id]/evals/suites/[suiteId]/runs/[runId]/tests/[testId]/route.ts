import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  getWorkflowEvalRunTestDefinitionContract,
  workflowEvalRunTestDefinitionResponseSchema,
} from '@/lib/api/contracts/workflow-evals'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeWorkflowEvalAccess, WorkflowEvalAccessError } from '@/lib/workflows/evals/access'
import {
  loadWorkflowEvalRunTestDefinition,
  WorkflowEvalRunTestDefinitionNotFoundError,
} from '@/lib/workflows/evals/run-detail-loader'

type RouteContext = {
  params: Promise<{ id: string; suiteId: string; runId: string; testId: string }>
}

export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(getWorkflowEvalRunTestDefinitionContract, request, context)
  if (!parsed.success) return parsed.response

  const { id: workflowId, suiteId, runId, testId } = parsed.data.params
  try {
    const access = await authorizeWorkflowEvalAccess({
      workflowId,
      userId: session.user.id,
      action: 'read',
    })
    const detail = await loadWorkflowEvalRunTestDefinition({
      workflowId,
      workspaceId: access.workspaceId,
      suiteId,
      runId,
      testId,
    })
    return NextResponse.json(workflowEvalRunTestDefinitionResponseSchema.parse(detail), {
      headers: { 'Cache-Control': 'private, max-age=31536000, immutable' },
    })
  } catch (error) {
    if (error instanceof WorkflowEvalAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof WorkflowEvalRunTestDefinitionNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    throw error
  }
})
