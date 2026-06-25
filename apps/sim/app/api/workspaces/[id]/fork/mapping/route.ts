import { db } from '@sim/db'
import { type NextRequest, NextResponse } from 'next/server'
import {
  getForkMappingContract,
  updateForkMappingContract,
} from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assertCanPromote } from '@/lib/workspaces/fork/lineage/authz'
import {
  applyForkMappingEntries,
  getForkMappingView,
  validateForkMappingTargets,
} from '@/lib/workspaces/fork/mapping/mapping-service'

export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getForkMappingContract, req, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params
    const { otherWorkspaceId, direction } = parsed.data.query

    const auth = await assertCanPromote(id, otherWorkspaceId, direction, session.user.id)

    const { entries } = await getForkMappingView({
      edge: auth.edge,
      sourceWorkspaceId: auth.sourceWorkspaceId,
      targetWorkspaceId: auth.targetWorkspaceId,
    })

    return NextResponse.json({
      childWorkspaceId: auth.edge.childWorkspaceId,
      parentWorkspaceId: auth.edge.parentWorkspaceId,
      sourceWorkspaceId: auth.sourceWorkspaceId,
      targetWorkspaceId: auth.targetWorkspaceId,
      entries,
    })
  }
)

export const PUT = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateForkMappingContract, req, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params
    const { otherWorkspaceId, direction, entries } = parsed.data.body

    const auth = await assertCanPromote(id, otherWorkspaceId, direction, session.user.id)

    await validateForkMappingTargets(auth.targetWorkspaceId, entries)

    const updated = await db.transaction((tx) =>
      applyForkMappingEntries(tx, auth.edge, session.user.id, direction, entries)
    )

    return NextResponse.json({ success: true as const, updated })
  }
)
