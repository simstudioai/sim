import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getWorkspaceOwnerBillingContract } from '@/lib/api/contracts/workspaces'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

/**
 * Subscription access state of the workspace's billed account — the workspace-
 * scoped counterpart to the viewer `/api/billing`. Lets the UI gate workspace
 * features (e.g. the deploy modal) on the owner's plan rather than the viewer's,
 * so a free member of a paid workspace isn't shown an upgrade wall.
 */
export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getWorkspaceOwnerBillingContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const ownerAccess = await getWorkspaceOwnerSubscriptionAccess(workspaceId)
    return NextResponse.json(ownerAccess)
  }
)
