import { type NextRequest, NextResponse } from 'next/server'
import { getForkAvailabilityContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isForkingAvailableForWorkspace } from '@/lib/workspaces/fork/lineage/authz'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

/**
 * Whether forking is available for this workspace: the server-evaluated verdict of the
 * same gate every fork route enforces (env/plan + the `workspace-forking` AppConfig
 * rollout flag). Member-readable — it only reveals feature on/off, and the client uses
 * it to show/hide the Forks settings tab and context-menu entries.
 */
export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getForkAvailabilityContract, req, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params

    const access = await checkWorkspaceAccess(id, session.user.id)
    if (!access.exists || !access.workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const available = await isForkingAvailableForWorkspace(
      access.workspace.organizationId,
      session.user.id
    )
    return NextResponse.json({ available })
  }
)
