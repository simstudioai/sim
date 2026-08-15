import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getForkForestContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getManageableWorkspaces } from '@/lib/workspaces/permissions/utils'
import { assertWorkspaceAdminAccess } from '@/ee/workspace-forking/lib/lineage/authz'
import { getForkForest } from '@/ee/workspace-forking/lib/lineage/forest'

/**
 * Every fork lineage the viewer can reach from this workspace, as flat depth-first rows.
 *
 * Admin on the anchor is the gate, matching every other fork route; each returned node then
 * carries its own `viewerAccessible` / `viewerCanAdmin` so the console can gate per row rather
 * than hiding a link and breaking the chain.
 */
export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getForkForestContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params

    await assertWorkspaceAdminAccess(workspaceId, session.user.id)

    const manageable = await getManageableWorkspaces(session.user.id)
    const nodes = await getForkForest({
      anchorWorkspaceId: workspaceId,
      viewerId: session.user.id,
      manageableWorkspaceIds: manageable.map((entry) => entry.id),
    })

    return NextResponse.json({ workspaceId, nodes })
  }
)
