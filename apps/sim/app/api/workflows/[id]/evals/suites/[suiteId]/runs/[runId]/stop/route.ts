import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  stopWorkflowEvalRunContract,
  stopWorkflowEvalRunResponseSchema,
} from '@/lib/api/contracts/workflow-evals'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { isCrossSiteSessionRequest } from '@/lib/core/security/same-origin'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  stopWorkflowEvalRun,
  WorkflowEvalRunNotActiveError,
  WorkflowEvalRunNotFoundError,
} from '@/lib/workflows/evals/run-service'

type RouteContext = { params: Promise<{ id: string; suiteId: string; runId: string }> }

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (isCrossSiteSessionRequest(request)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const parsed = await parseRequest(stopWorkflowEvalRunContract, request, context)
  if (!parsed.success) return parsed.response

  const userId = session.user.id
  const { id: workflowId, suiteId, runId } = parsed.data.params
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action: 'write',
  })

  if (!authorization.workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }
  if (!authorization.allowed) {
    return NextResponse.json(
      { error: authorization.message || 'Access denied' },
      { status: authorization.status }
    )
  }

  const workspaceId = authorization.workflow.workspaceId
  if (!workspaceId) {
    throw new Error(`Workflow ${workflowId} is not attached to a workspace`)
  }

  const [workspaceRow] = await db
    .select({ organizationId: workspace.organizationId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  if (!workspaceRow) {
    throw new Error(`Workspace ${workspaceId} was not found for workflow ${workflowId}`)
  }

  const enabled = await isFeatureEnabled('workflow-evals', {
    userId,
    orgId: workspaceRow.organizationId ?? undefined,
  })
  if (!enabled) {
    return NextResponse.json({ error: 'Workflow evals are not enabled' }, { status: 403 })
  }

  try {
    const run = await stopWorkflowEvalRun({
      workflowId,
      suiteId,
      runId,
      workspaceId,
      userId,
    })
    return NextResponse.json(stopWorkflowEvalRunResponseSchema.parse(run))
  } catch (error) {
    if (error instanceof WorkflowEvalRunNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof WorkflowEvalRunNotActiveError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
})
