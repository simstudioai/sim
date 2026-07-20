import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { streamWorkflowEvalsContract } from '@/lib/api/contracts/workflow-evals'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSSEStream } from '@/lib/events/sse-endpoint'
import { workflowEvalPubSub } from '@/lib/workflows/evals/pubsub'

type RouteContext = { params: Promise<{ id: string }> }

const WORKFLOW_EVAL_STREAM_BUFFER_BYTES = 4 * 1024 * 1024
const WORKFLOW_EVAL_STREAM_MAX_DURATION_MS = 5 * 60 * 1000

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(streamWorkflowEvalsContract, request, context)
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
  if (!enabled) {
    return NextResponse.json({ error: 'Workflow evals are not enabled' }, { status: 403 })
  }
  const pubSub = workflowEvalPubSub
  if (!pubSub) {
    throw new Error('Workflow eval event transport is unavailable')
  }

  return createSSEStream({
    label: 'workflow-evals',
    request,
    metadata: { workflowId, workspaceId },
    maxBufferedBytes: WORKFLOW_EVAL_STREAM_BUFFER_BYTES,
    maxConnectionDurationMs: WORKFLOW_EVAL_STREAM_MAX_DURATION_MS,
    subscribe: (send) => {
      const unsubscribe = pubSub.subscribe((event) => {
        if (event.workspaceId !== workspaceId || event.workflowId !== workflowId) return
        send('workflow_eval_update', event)
      })
      send('workflow_eval_ready', { workflowId })
      return unsubscribe
    },
  })
})
