import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getWorkflowReferencesContract } from '@/lib/api/contracts/workflow-references'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkflowReferences } from '@/lib/workflows/references/operations'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(getWorkflowReferencesContract, request, context)
  if (!parsed.success) return parsed.response

  const { id } = parsed.data.params

  const auth = await authorizeWorkflowByWorkspacePermission({
    workflowId: id,
    userId: session.user.id,
    action: 'read',
  })
  if (!auth.allowed || !auth.workflow?.workspaceId) {
    return NextResponse.json(
      { error: auth.message ?? 'Access denied' },
      { status: auth.allowed ? 403 : auth.status }
    )
  }

  const references = await getWorkflowReferences(auth.workflow.workspaceId, id)
  return NextResponse.json(references)
})
