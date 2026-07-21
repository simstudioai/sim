import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  getWorkflowEvalSuitesContract,
  workflowEvalSuitesResponseSchema,
} from '@/lib/api/contracts/workflow-evals'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadWorkflowEvalSuites } from '@/lib/workflows/evals/loader'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(getWorkflowEvalSuitesContract, request, context)
  if (!parsed.success) return parsed.response

  const userId = session.user.id
  const workflowId = parsed.data.params.id
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action: 'read',
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
  const response = workflowEvalSuitesResponseSchema.parse({
    enabled,
    suites: enabled ? await loadWorkflowEvalSuites(workflowId, workspaceId) : [],
  })

  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
})
