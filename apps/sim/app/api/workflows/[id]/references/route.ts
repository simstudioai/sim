import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getWorkflowReferencesContract } from '@/lib/api/contracts/workflow-references'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkflowReferences } from '@/lib/workflows/references/operations'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(getWorkflowReferencesContract, request, context)
  if (!parsed.success) return parsed.response

  const { params, query } = parsed.data

  const permission = await getUserEntityPermissions(session.user.id, 'workspace', query.workspaceId)
  if (permission === null) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const references = await getWorkflowReferences(query.workspaceId, params.id)
  return NextResponse.json(references)
})
