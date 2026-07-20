import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  startWorkflowEvalSuiteRunContract,
  startWorkflowEvalSuiteRunResponseSchema,
} from '@/lib/api/contracts/workflow-evals'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { isCrossSiteSessionRequest } from '@/lib/core/security/same-origin'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  startWorkflowEvalSuiteRun,
  startWorkflowEvalTestRun,
  WorkflowEvalDefinitionRevisionConflictError,
  WorkflowEvalEnqueueError,
  WorkflowEvalRunAlreadyActiveError,
  WorkflowEvalSuiteArchivedError,
  WorkflowEvalSuiteNotFoundError,
  WorkflowEvalSuiteNotRunnableError,
  WorkflowEvalTestNotFoundError,
} from '@/lib/workflows/evals/run-service'
import { WorkflowEvalSnapshotTargetError } from '@/lib/workflows/evals/snapshot-targets'

type RouteContext = { params: Promise<{ id: string; suiteId: string }> }

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (isCrossSiteSessionRequest(request)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const parsed = await parseRequest(startWorkflowEvalSuiteRunContract, request, context)
  if (!parsed.success) return parsed.response

  const userId = session.user.id
  const { id: workflowId, suiteId } = parsed.data.params
  const { testId, expectedDefinitionRevision } = parsed.data.body
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
    let run
    if (testId) {
      if (expectedDefinitionRevision === undefined) {
        throw new Error('Parsed test-scoped Eval run is missing its definition revision')
      }
      run = await startWorkflowEvalTestRun({
        workflowId,
        suiteId,
        testId,
        workspaceId,
        userId,
        expectedDefinitionRevision,
      })
    } else {
      run = await startWorkflowEvalSuiteRun({
        workflowId,
        suiteId,
        workspaceId,
        userId,
        expectedDefinitionRevision,
      })
    }
    return NextResponse.json(startWorkflowEvalSuiteRunResponseSchema.parse(run), { status: 202 })
  } catch (error) {
    if (
      error instanceof WorkflowEvalSuiteNotFoundError ||
      error instanceof WorkflowEvalTestNotFoundError
    ) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof WorkflowEvalRunAlreadyActiveError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (
      error instanceof WorkflowEvalSuiteArchivedError ||
      error instanceof WorkflowEvalDefinitionRevisionConflictError
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof WorkflowEvalSuiteNotRunnableError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    if (error instanceof WorkflowEvalSnapshotTargetError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    if (error instanceof WorkflowEvalEnqueueError) {
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    throw error
  }
})
